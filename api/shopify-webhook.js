// Fonction Vercel qui reçoit chaque nouvelle commande Shopify
// et l'enregistre automatiquement dans RecuVente (Supabase)

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Vérifie que la requête vient bien de Shopify (sécurité)
function verifyShopifyWebhook(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return true; // si pas configuré, on laisse passer (à sécuriser plus tard)
  const generatedHash = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  return generatedHash === hmacHeader;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const order = req.body;

    // Extraction des infos utiles de la commande Shopify
    const client = order.customer
      ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
      : order.shipping_address?.name || "Client Shopify";

    const tel =
      order.shipping_address?.phone ||
      order.customer?.phone ||
      order.phone ||
      "Non renseigné";

    const produits = (order.line_items || [])
      .map((item) => `${item.title} x${item.quantity}`)
      .join(", ");

    const montant = order.total_price || 0;

    const zone = order.shipping_address
      ? `${order.shipping_address.city || ""}, ${order.shipping_address.address1 || ""}`.trim()
      : "";

    // Détecte automatiquement si la commande est à Abidjan ou à expédier ailleurs,
    // selon la ville renseignée sur Shopify.
    const villeNormalisee = (order.shipping_address?.city || "").toLowerCase().trim();
    const estAbidjan = villeNormalisee.includes("abidjan") || villeNormalisee === "";
    const typeLivraison = estAbidjan ? "abidjan" : "expedition";
    const fraisExpedition = estAbidjan ? 0 : Number(order.total_shipping_price_set?.shop_money?.amount || 0);

    // Attribution automatique au closer ayant le moins de commandes actives en ce moment
    let closerAssigne = null;
    const { data: closersList } = await supabase.from("closers").select("nom");
    if (closersList && closersList.length > 0) {
      const { data: commandesActives } = await supabase
        .from("commandes")
        .select("closer")
        .in("statut", ["en_cours", "echouee"])
        .not("closer", "is", null);

      const charge = {};
      closersList.forEach((c) => (charge[c.nom] = 0));
      (commandesActives || []).forEach((o) => {
        if (charge[o.closer] !== undefined) charge[o.closer] += 1;
      });

      closerAssigne = closersList.reduce((min, c) =>
        charge[c.nom] < charge[min.nom] ? c : min
      , closersList[0]).nom;
    }

    const { error } = await supabase.from("commandes").insert([
      {
        client: client || "Client Shopify",
        tel,
        produit: produits || "Commande Shopify",
        montant: Number(montant),
        zone,
        statut: "en_cours",
        derniere_tentative: `Importée depuis Shopify #${order.order_number || order.id}`,
        recupere: false,
        closer: closerAssigne,
        type_livraison: typeLivraison,
        frais_expedition: fraisExpedition,
      },
    ]);

    if (error) {
      console.error("Erreur Supabase:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Erreur webhook:", err);
    return res.status(500).json({ error: err.message });
  }
}
