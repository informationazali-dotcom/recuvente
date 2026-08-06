 // Fonction Vercel qui reçoit chaque nouvelle commande Shopify
// et l'enregistre automatiquement dans RecuVente (Supabase)

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
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
