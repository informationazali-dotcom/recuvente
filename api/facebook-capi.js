 import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function hasher(valeur) {
  if (!valeur) return null;
  return crypto.createHash("sha256").update(String(valeur).trim().toLowerCase()).digest("hex");
}

function normaliserTelephone(tel) {
  let chiffres = String(tel || "").replace(/\D/g, "");
  if (chiffres.startsWith("00")) chiffres = chiffres.slice(2);
  if (!chiffres.startsWith("225") && chiffres.length <= 10) chiffres = "225" + chiffres.replace(/^0/, "");
  return "+" + chiffres;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  const { commandeId } = req.body;
  if (!commandeId) return res.status(400).json({ error: "commandeId manquant" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Non authentifié" });

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: "Session invalide" });

  const PIXEL_ID = process.env.FACEBOOK_PIXEL_ID;
  const CAPI_TOKEN = process.env.FACEBOOK_CAPI_TOKEN;

  if (!PIXEL_ID || !CAPI_TOKEN) {
    // Pas encore configuré côté serveur — on ignore silencieusement
    return res.status(200).json({ envoye: false, raison: "FACEBOOK_PIXEL_ID ou FACEBOOK_CAPI_TOKEN non configuré sur Vercel" });
  }

  const { data: commande, error: erreurCommande } = await supabaseAdmin
    .from("commandes")
    .select("id, client, tel, montant, frais_expedition, statut, confirmed_at")
    .eq("id", commandeId)
    .single();

  if (erreurCommande || !commande) return res.status(404).json({ error: "Commande introuvable" });

  const montantTotal = Number(commande.montant) + Number(commande.frais_expedition || 0);

  const evenement = {
    event_name: "Purchase",
    event_time: Math.floor(new Date(commande.confirmed_at || Date.now()).getTime() / 1000),
    action_source: "system_generated",
    event_id: `commande-${commande.id}`,
    user_data: {
      ph: [hasher(normaliserTelephone(commande.tel))].filter(Boolean),
    },
    custom_data: {
      value: montantTotal,
      currency: "XOF",
    },
  };

  try {
    const reponseFacebook = await fetch(
      `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${CAPI_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [evenement] }),
      }
    );
    const resultatFacebook = await reponseFacebook.json();

    if (!reponseFacebook.ok) {
      return res.status(400).json({ envoye: false, error: resultatFacebook.error?.message || "Erreur Facebook" });
    }

    return res.status(200).json({ envoye: true, resultatFacebook });
  } catch (e) {
    return res.status(500).json({ envoye: false, error: e.message });
  }
}
