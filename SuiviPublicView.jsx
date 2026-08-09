import React, { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

function formatFCFA(n) {
  return Number(n).toLocaleString("fr-FR").replace(/,/g, " ") + " F";
}

const ETAPES = [
  { key: "en_cours", label: "Commande reçue" },
  { key: "confirmee", label: "Livrée" },
];

export default function SuiviPublicView({ commandeId }) {
  const [commande, setCommande] = useState(undefined);
  const [erreur, setErreur] = useState(null);
  const [confirme, setConfirme] = useState(false);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  async function confirmerReception() {
    setEnvoiEnCours(true);
    const { error } = await supabase.rpc("confirmer_reception", { p_id: commandeId });
    if (!error) setConfirme(true);
    setEnvoiEnCours(false);
  }

  useEffect(() => {
    supabase
      .rpc("suivi_commande", { p_id: commandeId })
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setErreur("Commande introuvable.");
        } else {
          setCommande(data[0]);
        }
      });
  }, [commandeId]);

  const etapeActuelle =
    commande?.statut === "confirmee" ? 1 : commande?.statut === "echouee" ? -1 : 0;

  return (
    <div
      style={{
        background: "#FAFAF7",
        minHeight: "100vh",
        fontFamily: "'IBM Plex Sans', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');`}</style>

      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, marginBottom: 24 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "#1a7a3c", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 100 100">
              <polyline points="15,62 40,42 55,56 85,28" stroke="#e8920a" strokeWidth="11" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19, color: "#16231F" }}>
            AZALI <span style={{ color: "#e8920a" }}>EXPRESS</span>
          </div>
        </div>

        {commande === undefined && !erreur && (
          <div style={{ textAlign: "center", color: "#8A9089", padding: "40px 0" }}>Chargement…</div>
        )}

        {erreur && (
          <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 16, padding: 26, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
            <div style={{ color: "#6B7168", fontSize: 14 }}>{erreur}</div>
          </div>
        )}

        {commande && (
          <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 16, padding: 24 }}>
            <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Bonjour {commande.client?.split(" ")[0]}
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 18, marginTop: 4 }}>
              {commande.produit}
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 22, color: "#1a7a3c", marginTop: 6 }}>
              {formatFCFA(commande.montant)}
            </div>

            {etapeActuelle === -1 ? (
              <div style={{ background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 12, padding: 14, marginTop: 20, textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>⚠️</div>
                <div style={{ color: "#D64933", fontWeight: 600, fontSize: 13.5 }}>
                  Nous n'avons pas pu finaliser la livraison. Notre équipe va vous recontacter.
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 0 }}>
                {ETAPES.map((etape, i) => {
                  const atteint = i <= etapeActuelle;
                  const estDernier = i === ETAPES.length - 1;
                  return (
                    <div key={etape.key} style={{ display: "flex", gap: 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: "50%",
                            background: atteint ? "#1a7a3c" : "#ECE8DC",
                            color: atteint ? "white" : "#8A9089",
                            fontSize: 12,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {atteint ? "✓" : i + 1}
                        </div>
                        {!estDernier && (
                          <div style={{ width: 2, flex: 1, minHeight: 30, background: atteint && i < etapeActuelle ? "#1a7a3c" : "#ECE8DC", marginTop: 2 }} />
                        )}
                      </div>
                      <div style={{ paddingBottom: 26 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: atteint ? "#16231F" : "#8A9089" }}>{etape.label}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {commande.date_relivraison && etapeActuelle !== 1 && (
              <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 4 }}>
                📅 Livraison prévue le {new Date(commande.date_relivraison + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
              </div>
            )}

            {etapeActuelle === 1 && (
              <div style={{ marginTop: 16 }}>
                {!confirme ? (
                  <button
                    onClick={confirmerReception}
                    disabled={envoiEnCours}
                    style={{ width: "100%", background: "#1a7a3c", color: "white", border: "none", padding: "13px 0", borderRadius: 10, fontWeight: 700, fontSize: 14, opacity: envoiEnCours ? 0.6 : 1 }}
                  >
                    {envoiEnCours ? "..." : "✅ J'ai bien reçu ma commande"}
                  </button>
                ) : (
                  <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 10, padding: "12px 0", textAlign: "center", color: "#3B6D11", fontWeight: 600, fontSize: 13.5 }}>
                    Merci pour votre confirmation ! 🙏
                  </div>
                )}
              </div>
            )}

            <a
              href="https://wa.me/2250711355743"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: "#1F9D6E",
                color: "white",
                padding: "12px 0",
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 13.5,
                textDecoration: "none",
                marginTop: 18,
              }}
            >
              💬 Une question ? Écrivez-nous sur WhatsApp
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
