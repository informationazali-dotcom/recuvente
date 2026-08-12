import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabaseClient";

function cleanPhoneForWhatsApp(tel) {
  let digits = String(tel).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("225")) return digits;
  digits = digits.replace(/^0/, "");
  return "225" + digits;
}

function numeroFacture(commande) {
  const date = new Date(commande.created_at);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const short = commande.id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `F-${y}${m}-${short}`;
}

async function genererFacturePDF(commande, workspace) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const green = [26, 122, 60];
  const orange = [232, 146, 10];
  const gray = [107, 113, 104];
  const dark = [22, 35, 31];

  doc.setFillColor(...green);
  doc.rect(0, 0, 210, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(workspace.name.toUpperCase(), 15, 18);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(workspace.country || "", 15, 25);

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURE", 195, 18, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(numeroFacture(commande), 195, 25, { align: "right" });

  let y = 46;
  doc.setTextColor(...gray);
  doc.setFontSize(9);
  doc.text("FACTURÉ À", 15, y);
  doc.text("DATE", 140, y);

  y += 6;
  doc.setTextColor(...dark);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(commande.client || "", 15, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(new Date(commande.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), 140, y);

  y += 6;
  doc.setFontSize(10);
  doc.setTextColor(...gray);
  doc.text(commande.tel || "", 15, y);
  if (commande.zone) {
    y += 5;
    doc.text(commande.zone, 15, y, { maxWidth: 90 });
  }

  y += 14;
  doc.setFillColor(...green);
  doc.rect(15, y, 180, 9, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("PRODUIT", 18, y + 6);
  doc.text("MONTANT", 190, y + 6, { align: "right" });

  y += 9;
  doc.setDrawColor(230, 230, 225);
  doc.setTextColor(...dark);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.rect(15, y, 180, 12);
  doc.text(commande.produit || "", 18, y + 8, { maxWidth: 130 });
  const montantTxt = `${Number(commande.montant).toLocaleString("fr-FR")} ${workspace.currency}`;
  doc.text(montantTxt, 190, y + 8, { align: "right" });

  y += 20;
  doc.setDrawColor(...green);
  doc.setLineWidth(0.5);
  doc.line(120, y, 195, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...dark);
  doc.text("TOTAL", 120, y);
  doc.setTextColor(...orange);
  doc.setFontSize(14);
  doc.text(montantTxt, 195, y, { align: "right" });

  y += 12;
  const statutPaiement = commande.statut === "confirmee" ? "PAYÉE (à la livraison)" : "EN ATTENTE DE PAIEMENT";
  const couleurStatut = commande.statut === "confirmee" ? green : orange;
  doc.setFillColor(...couleurStatut);
  doc.roundedRect(15, y, 75, 9, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(statutPaiement, 52.5, y + 6, { align: "center" });

  doc.setTextColor(...gray);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Merci pour votre confiance — ${workspace.name}`, 105, 280, { align: "center" });
  doc.text("Paiement à la livraison (COD) — Facture générée automatiquement", 105, 285, { align: "center" });

  const nomFichier = `Facture-${numeroFacture(commande)}.pdf`;
  const blob = doc.output("blob");
  const fichier = new File([blob], nomFichier, { type: "application/pdf" });

  if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
    navigator.share({ files: [fichier], title: nomFichier }).catch(() => doc.save(nomFichier));
  } else {
    doc.save(nomFichier);
  }
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [workspace, setWorkspace] = useState(undefined);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadWorkspace() {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) {
      setWorkspace(null);
      return;
    }
    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name, country, currency, created_at)")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      setWorkspace({ ...data.workspaces, role: data.role });
    } else {
      setWorkspace(null);
    }
  }

  const [subscription, setSubscription] = useState(undefined);

  async function loadSubscription(workspaceId) {
    const { data } = await supabase
      .from("subscriptions")
      .select("*, subscription_plans(nom, prix, devise, max_commandes_mois)")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    setSubscription(data || null);
  }

  useEffect(() => {
    if (workspace && workspace.id) loadSubscription(workspace.id);
  }, [workspace?.id]);

  useEffect(() => {
    if (session) loadWorkspace();
  }, [session]);

  async function creerWorkspace(nom) {
    setLoadingWorkspace(true);
    const { data: ws, error } = await supabase
      .from("workspaces")
      .insert([{ owner_id: session.user.id, name: nom }])
      .select()
      .single();
    if (error) {
      alert("Erreur: " + error.message);
      setLoadingWorkspace(false);
      return;
    }
    await supabase.from("workspace_members").insert([
      { workspace_id: ws.id, user_id: session.user.id, role: "owner" },
    ]);
    await loadWorkspace();
    setLoadingWorkspace(false);
  }

  if (session === undefined) return <Centered>Chargement…</Centered>;

  const resetPwParam = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("resetpw") === "1";
  if (resetPwParam && session) return <NouveauMotDePasseScreen />;

  const pageParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("page") : null;
  if (pageParam === "cgu" || pageParam === "confidentialite") return <PageLegale page={pageParam} />;

  if (!session) {
    const wantsAuth = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("auth") === "1";
    if (!wantsAuth) return <LandingPage />;
    return <AuthScreen />;
  }

  const isAdminRoute = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("admin") === "1";
  if (isAdminRoute) return <AdminPanel session={session} />;

  if (workspace === undefined) return <Centered>Chargement de ton espace…</Centered>;
  if (workspace === null) return <CreateWorkspaceScreen onCreate={creerWorkspace} loading={loadingWorkspace} />;

  return <WorkspaceDashboard workspace={workspace} session={session} subscription={subscription} />;
}

function Centered({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Sans', sans-serif", background: "#FAFAF7" }}>
      {children}
    </div>
  );
}

function LandingPage() {
  const [plans, setPlans] = useState([]);
  const [faqOuverte, setFaqOuverte] = useState(null);

  useEffect(() => {
    supabase.from("subscription_plans").select("*").order("prix").then(({ data }) => setPlans(data || []));
  }, []);

  const faq = [
    { q: "Comment fonctionne l'essai gratuit ?", r: "7 jours d'accès complet dès l'inscription, sur le plan Pro. Aucune carte bancaire requise. Tu peux annuler ou continuer à tout moment." },
    { q: "Comment se fait le paiement ?", r: "Par Mobile Money. Tu demandes le plan de ton choix depuis l'app, effectues le transfert, et l'accès s'active dès la confirmation reçue." },
    { q: "Mes données sont-elles visibles par d'autres entreprises ?", r: "Non, jamais. Chaque entreprise a son espace complètement isolé et sécurisé — personne d'autre ne peut voir tes commandes, clients ou finances." },
    { q: "Puis-je changer de plan plus tard ?", r: "Oui, à tout moment, selon la croissance de ton activité." },
    { q: "Ça fonctionne pour quel type de commerce ?", r: "Pensé pour la vente en paiement à la livraison (COD) — tout commerce avec des livreurs et une équipe de vente peut l'utiliser." },
  ];

  const fonctionnalites = [
    { icon: "📋", titre: "Commandes & suivi", desc: "Statuts en temps réel, historique complet, jamais un client oublié." },
    { icon: "🚚", titre: "Livreurs avec GPS", desc: "Suis leur tournée en direct, commissions calculées automatiquement." },
    { icon: "🎧", titre: "Équipe de closers", desc: "Rôles restreints, répartition équitable, aucun doublon d'appel." },
    { icon: "🧮", titre: "Comptabilité claire", desc: "Bénéfice réel, dépôts par livreur, coût produit — sans surprise." },
    { icon: "📦", titre: "Stock & produits", desc: "Sais exactement combien il te reste, avant la rupture." },
    { icon: "🔄", titre: "Réachat automatique", desc: "L'app te dit qui relancer, et quand, selon leur rythme d'achat." },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF7", fontFamily: "'IBM Plex Sans', sans-serif", color: "#16231F" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');`}</style>

      <div style={{ background: "#1a7a3c", color: "white", padding: "60px 24px 70px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, marginBottom: 30 }}>
          RECU<span style={{ color: "#e8920a" }}>VENTE</span>
        </div>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 34, lineHeight: 1.25, maxWidth: 480, margin: "0 auto" }}>
          Le logiciel qui organise ton e-commerce en paiement à la livraison
        </div>
        <div style={{ fontSize: 15, opacity: 0.85, marginTop: 16, maxWidth: 420, margin: "16px auto 0" }}>
          Commandes, livreurs, closers, comptabilité — tout au même endroit, pensé pour le COD en Afrique de l'Ouest.
        </div>
        <a href="?auth=1" style={{ display: "inline-block", marginTop: 28, background: "#e8920a", color: "white", padding: "14px 32px", borderRadius: 12, fontWeight: 700, fontSize: 15, textDecoration: "none" }}>
          Essayer gratuitement — 7 jours
        </a>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>Sans carte bancaire</div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "50px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
          {fonctionnalites.map((f, i) => (
            <div key={i} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 14, padding: 22 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>{f.titre}</div>
              <div style={{ fontSize: 13, color: "#6B7168", lineHeight: 1.5 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {plans.length > 0 && (
        <div style={{ background: "white", padding: "50px 24px", borderTop: "1px solid #ECE8DC", borderBottom: "1px solid #ECE8DC" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 26 }}>Des tarifs simples et transparents</div>
            <div style={{ fontSize: 14, color: "#6B7168", marginTop: 8 }}>7 jours gratuits sur n'importe quel plan, sans engagement.</div>
          </div>
          <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            {plans.map((p, i) => (
              <div key={p.id} style={{ border: i === 1 ? "2px solid #1a7a3c" : "1px solid #ECE8DC", borderRadius: 16, padding: 22, position: "relative", background: i === 1 ? "#FAFAF7" : "white" }}>
                {i === 1 && (
                  <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: "#1a7a3c", color: "white", fontSize: 10.5, fontWeight: 700, padding: "3px 12px", borderRadius: 999 }}>
                    LE PLUS CHOISI
                  </div>
                )}
                <div style={{ fontWeight: 700, fontSize: 16, marginTop: i === 1 ? 6 : 0 }}>{p.nom}</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 24, marginTop: 8, color: "#1a7a3c" }}>
                  {Number(p.prix).toLocaleString("fr-FR")} <span style={{ fontSize: 12, fontWeight: 500, color: "#8A9089" }}>{p.devise}/mois</span>
                </div>
                <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 12, lineHeight: 1.7 }}>
                  {p.max_commandes_mois ? `${p.max_commandes_mois} commandes/mois` : "Commandes illimitées"}<br />
                  {p.max_membres ? `${p.max_membres} membres max` : "Membres illimités"}
                </div>
                <a href="?auth=1" style={{ display: "block", textAlign: "center", marginTop: 18, background: i === 1 ? "#1a7a3c" : "white", color: i === 1 ? "white" : "#1a7a3c", border: i === 1 ? "none" : "1px solid #1a7a3c", padding: "10px 0", borderRadius: 9, fontWeight: 700, fontSize: 13, textDecoration: "none" }}>
                  Commencer
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "50px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 26 }}>Questions fréquentes</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {faq.map((f, i) => (
            <div key={i} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, overflow: "hidden" }}>
              <button
                onClick={() => setFaqOuverte(faqOuverte === i ? null : i)}
                style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "16px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              >
                <span style={{ fontWeight: 600, fontSize: 14.5 }}>{f.q}</span>
                <span style={{ color: "#1a7a3c", fontSize: 16, flexShrink: 0, marginLeft: 10 }}>{faqOuverte === i ? "−" : "+"}</span>
              </button>
              {faqOuverte === i && (
                <div style={{ padding: "0 18px 16px", fontSize: 13.5, color: "#6B7168", lineHeight: 1.6 }}>{f.r}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#16231F", color: "white", padding: "50px 24px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 24, marginBottom: 10 }}>Prêt à essayer ?</div>
        <div style={{ fontSize: 14, opacity: 0.75, marginBottom: 24 }}>7 jours gratuits, aucune carte requise.</div>
        <a href="?auth=1" style={{ display: "inline-block", background: "#1a7a3c", color: "white", padding: "14px 32px", borderRadius: 12, fontWeight: 700, fontSize: 15, textDecoration: "none" }}>
          Créer mon espace
        </a>
      </div>

      <div style={{ textAlign: "center", padding: "20px 24px", fontSize: 12, color: "#8A9089" }}>
        RecuVente — {new Date().getFullYear()}
        <div style={{ marginTop: 8, display: "flex", gap: 16, justifyContent: "center" }}>
          <a href="?page=cgu" style={{ color: "#8A9089", textDecoration: "underline" }}>Conditions d'utilisation</a>
          <a href="?page=confidentialite" style={{ color: "#8A9089", textDecoration: "underline" }}>Confidentialité</a>
        </div>
      </div>
    </div>
  );
}

function PageLegale({ page }) {
  const contenu = {
    cgu: {
      titre: "Conditions Générales d'Utilisation",
      texte: `Dernière mise à jour : ${new Date().toLocaleDateString("fr-FR")}

1. OBJET
RecuVente est une plateforme logicielle permettant aux entreprises de gestion de commandes en paiement à la livraison (COD) de gérer leurs commandes, équipes, livraisons et comptabilité.

2. INSCRIPTION ET ESSAI GRATUIT
Toute entreprise peut créer un espace et bénéficier d'un essai gratuit de 7 jours. Aucune carte bancaire n'est requise pour l'essai. À l'issue de l'essai, l'accès aux fonctionnalités de création de commandes est suspendu jusqu'à activation d'un abonnement payant, sans suppression des données existantes.

3. ABONNEMENTS ET PAIEMENT
Les tarifs des différents plans sont affichés sur la page d'accueil. Le paiement s'effectue par Mobile Money. L'activation du plan payant intervient après confirmation manuelle de la réception du paiement par l'équipe RecuVente.

4. DONNÉES DE L'ENTREPRISE CLIENTE
Chaque entreprise reste propriétaire de ses données (commandes, clients, équipe, finances). RecuVente s'engage à ne jamais partager ces données avec une autre entreprise cliente de la plateforme.

5. RÉSILIATION
Une entreprise peut cesser d'utiliser le service à tout moment. Les données restent accessibles en lecture pendant une période raisonnable après la fin de l'abonnement, sauf demande explicite de suppression.

6. RESPONSABILITÉ
RecuVente met à disposition un outil de gestion. La responsabilité de l'exactitude des données saisies (commandes, montants, coûts) incombe à l'entreprise cliente. RecuVente ne saurait être tenu responsable des pertes commerciales liées à une mauvaise utilisation de l'outil.

7. MODIFICATION DES CONDITIONS
Ces conditions peuvent être amenées à évoluer. Les entreprises clientes seront informées de tout changement significatif.

⚠️ Ce document est un modèle de départ, non validé par un juriste. Avant tout lancement commercial réel, une relecture par un professionnel du droit ivoirien (ou de la juridiction concernée) est fortement recommandée.`,
    },
    confidentialite: {
      titre: "Politique de confidentialité",
      texte: `Dernière mise à jour : ${new Date().toLocaleDateString("fr-FR")}

1. DONNÉES COLLECTÉES
RecuVente collecte : l'email et le mot de passe de connexion, le nom de l'entreprise, les données de commandes (clients, produits, montants), et les informations d'équipe (livreurs, closers, comptables) que vous saisissez volontairement.

2. UTILISATION DES DONNÉES
Ces données sont utilisées exclusivement pour faire fonctionner votre espace de gestion — jamais revendues, jamais partagées avec d'autres entreprises clientes de la plateforme, jamais utilisées à des fins publicitaires tierces.

3. ISOLATION ENTRE ENTREPRISES
Chaque entreprise cliente dispose d'un espace strictement isolé au niveau technique (base de données). Aucune entreprise ne peut accéder aux données d'une autre, même par erreur.

4. HÉBERGEMENT
Les données sont hébergées via Supabase (infrastructure cloud sécurisée) et Vercel.

5. VOS DROITS
Vous pouvez demander l'export ou la suppression complète de vos données à tout moment en contactant l'équipe RecuVente.

6. NOTIFICATIONS
Avec votre autorisation explicite, RecuVente peut vous envoyer des notifications sonores dans l'application lors de l'arrivée de nouvelles commandes.

⚠️ Ce document est un modèle de départ, non validé par un juriste. Avant tout lancement commercial réel, une relecture par un professionnel du droit est fortement recommandée.`,
    },
  };

  const c = contenu[page] || contenu.cgu;

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF7", fontFamily: "'IBM Plex Sans', sans-serif", padding: "40px 20px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <a href="?" style={{ fontSize: 13, color: "#1a7a3c", textDecoration: "underline" }}>← Retour à l'accueil</a>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 26, marginTop: 16, marginBottom: 20 }}>{c.titre}</div>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.7, color: "#16231F", background: "white", border: "1px solid #ECE8DC", borderRadius: 14, padding: 24 }}>
          {c.texte}
        </div>
      </div>
    </div>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signup");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetEnvoye, setResetEnvoye] = useState(false);
  const [confirmationRequise, setConfirmationRequise] = useState(false);

  async function submit() {
    setError("");
    setLoading(true);
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else if (data.user && !data.session) setConfirmationRequise(true);
    } else if (mode === "reset") {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "?resetpw=1",
      });
      if (error) setError(error.message);
      else setResetEnvoye(true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setLoading(false);
  }

  return (
    <Centered>
      <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 16, padding: 30, width: 340 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, marginBottom: 4 }}>RecuVente <span style={{ color: "#e8920a" }}>SaaS</span></div>
        <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 20 }}>
          {mode === "signup" ? "Crée ton compte et ton espace" : mode === "reset" ? "Réinitialiser ton mot de passe" : "Connexion"}
        </div>

        {mode === "reset" && resetEnvoye ? (
          <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 10, padding: "14px 12px", fontSize: 13, color: "#3B6D11", marginBottom: 14 }}>
            ✅ Un lien de réinitialisation a été envoyé à <strong>{email}</strong>. Vérifie ta boîte mail (et les spams).
          </div>
        ) : mode === "signup" && confirmationRequise ? (
          <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 10, padding: "14px 12px", fontSize: 13, color: "#3B6D11", marginBottom: 14 }}>
            ✅ Compte créé ! Un email de confirmation a été envoyé à <strong>{email}</strong>. Clique sur le lien reçu pour activer ton compte, puis reviens te connecter.
          </div>
        ) : (
          <>
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            {mode !== "reset" && (
              <input placeholder="Mot de passe" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
            )}
            {error && <div style={{ color: "#D64933", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
            <button onClick={submit} disabled={loading} style={btnStyle}>
              {loading ? "..." : mode === "signup" ? "Créer mon compte" : mode === "reset" ? "Envoyer le lien" : "Se connecter"}
            </button>
          </>
        )}

        {mode !== "reset" && (
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 12.5, color: "#6B7168", cursor: "pointer" }} onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
            {mode === "signup" ? "Déjà un compte ? Se connecter" : "Pas de compte ? S'inscrire"}
          </div>
        )}
        {mode === "login" && (
          <div style={{ textAlign: "center", marginTop: 8, fontSize: 12, color: "#8A9089", cursor: "pointer", textDecoration: "underline" }} onClick={() => { setMode("reset"); setError(""); setResetEnvoye(false); }}>
            Mot de passe oublié ?
          </div>
        )}
        {mode === "reset" && (
          <div style={{ textAlign: "center", marginTop: 8, fontSize: 12.5, color: "#6B7168", cursor: "pointer", textDecoration: "underline" }} onClick={() => { setMode("login"); setError(""); setResetEnvoye(false); }}>
            ← Retour à la connexion
          </div>
        )}
        <a href="?" style={{ display: "block", textAlign: "center", marginTop: 10, fontSize: 12, color: "#8A9089" }}>← Retour à l'accueil</a>
      </div>
    </Centered>
  );
}

function NouveauMotDePasseScreen() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [succes, setSucces] = useState(false);

  async function submit() {
    setError("");
    if (password.length < 6) {
      setError("Le mot de passe doit faire au moins 6 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setError(error.message);
    else setSucces(true);
    setLoading(false);
  }

  if (succes) {
    return (
      <Centered>
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 16, padding: 30, width: 340, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Mot de passe mis à jour</div>
          <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 18 }}>Tu peux maintenant te reconnecter.</div>
          <a href="?auth=1" style={{ ...btnStyle, display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}>Se connecter</a>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 16, padding: 30, width: 340 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Nouveau mot de passe</div>
        <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 20 }}>Choisis un nouveau mot de passe pour ton compte.</div>
        <input placeholder="Nouveau mot de passe" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        <input placeholder="Confirme le mot de passe" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputStyle} />
        {error && <div style={{ color: "#D64933", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button onClick={submit} disabled={loading} style={btnStyle}>
          {loading ? "..." : "Enregistrer"}
        </button>
      </div>
    </Centered>
  );
}

function CreateWorkspaceScreen({ onCreate, loading }) {
  const [nom, setNom] = useState("");
  return (
    <Centered>
      <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 16, padding: 30, width: 340 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 20, marginBottom: 4 }}>Bienvenue 👋</div>
        <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 20 }}>
          Nomme ton entreprise pour créer ton espace privé.
        </div>
        <input placeholder="Ex: Azali Express" value={nom} onChange={(e) => setNom(e.target.value)} style={inputStyle} />
        <button onClick={() => nom.trim() && onCreate(nom.trim())} disabled={loading || !nom.trim()} style={btnStyle}>
          {loading ? "Création..." : "Créer mon espace"}
        </button>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{ width: "100%", marginTop: 10, padding: "10px 0", borderRadius: 10, border: "1px solid #DDD8CC", background: "white", color: "#6B7168", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          Déconnexion
        </button>
      </div>
    </Centered>
  );
}

function WorkspaceDashboard({ workspace, session, subscription }) {
  const [commandes, setCommandes] = useState([]);
  const [livreurs, setLivreurs] = useState([]);
  const [closers, setClosers] = useState([]);
  const [produits, setProduits] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showAbonnement, setShowAbonnement] = useState(false);
  const [showLivreurs, setShowLivreurs] = useState(false);
  const [showClosers, setShowClosers] = useState(false);
  const [showCampagne, setShowCampagne] = useState(false);
  const [showProduits, setShowProduits] = useState(false);

  async function loadLivreurs() {
    const { data } = await supabase.from("livreurs").select("*").eq("workspace_id", workspace.id).order("nom");
    setLivreurs(data || []);
  }

  async function loadClosers() {
    const { data } = await supabase.from("closers").select("*").eq("workspace_id", workspace.id).order("nom");
    setClosers(data || []);
  }

  async function loadProduits() {
    const { data } = await supabase.from("produits").select("*").eq("workspace_id", workspace.id).order("nom");
    setProduits(data || []);
  }

  function parseProduitTexte(texte) {
    if (!texte) return { nom: "", quantite: 1 };
    const match = texte.match(/^(.*?)\s*x\s*(\d+)\s*$/i);
    if (match) return { nom: match[1].trim(), quantite: Number(match[2]) || 1 };
    return { nom: texte.trim(), quantite: 1 };
  }

  async function addProduit(form) {
    const { error } = await supabase.from("produits").insert([{ nom: form.nom, cout_achat: Number(form.cout_achat) || 0, workspace_id: workspace.id }]);
    if (error) alert("Erreur: " + error.message);
    else await loadProduits();
  }

  async function updateProduitCout(id, cout) {
    await supabase.from("produits").update({ cout_achat: Number(cout) || 0 }).eq("id", id);
    await loadProduits();
  }

  async function updateProduitStock(id, stock) {
    await supabase.from("produits").update({ stock_initial: Number(stock) || 0 }).eq("id", id);
    await loadProduits();
  }

  async function deleteProduit(id) {
    await supabase.from("produits").delete().eq("id", id);
    await loadProduits();
  }

  async function addLivreur(form) {
    const { error } = await supabase.from("livreurs").insert([{ ...form, workspace_id: workspace.id }]);
    if (error) alert("Erreur: " + error.message);
    else await loadLivreurs();
  }

  async function deleteLivreur(id, nom) {
    const commandesLiees = commandes.filter((c) => c.livreur === nom && (c.statut === "en_cours" || c.statut === "echouee")).length;
    if (commandesLiees > 0) {
      const confirmer = window.confirm(`${nom} a encore ${commandesLiees} commande${commandesLiees > 1 ? "s" : ""} active${commandesLiees > 1 ? "s" : ""} assignée${commandesLiees > 1 ? "s" : ""}. Si tu le retires, tu ne pourras plus les réassigner facilement. Continuer quand même ?`);
      if (!confirmer) return;
    }
    await supabase.from("livreurs").delete().eq("id", id);
    await loadLivreurs();
  }

  async function addCloser(form) {
    const { error } = await supabase.from("closers").insert([{ ...form, workspace_id: workspace.id }]);
    if (error) alert("Erreur: " + error.message);
    else await loadClosers();
  }

  async function deleteCloser(id, nom) {
    const commandesLiees = commandes.filter((c) => c.closer === nom && (c.statut === "en_cours" || c.statut === "echouee")).length;
    if (commandesLiees > 0) {
      const confirmer = window.confirm(`${nom} a encore ${commandesLiees} commande${commandesLiees > 1 ? "s" : ""} active${commandesLiees > 1 ? "s" : ""} assignée${commandesLiees > 1 ? "s" : ""}. Si tu le retires, tu ne pourras plus les réassigner facilement. Continuer quand même ?`);
      if (!confirmer) return;
    }
    await supabase.from("closers").delete().eq("id", id);
    await loadClosers();
  }

  async function assignLivreur(commandeId, nom) {
    await supabase.from("commandes").update({ livreur: nom || null }).eq("id", commandeId);
    await supabase.from("relances").insert([
      { commande_id: commandeId, note: nom ? `🚚 Livreur assigné : ${nom}` : "🚚 Livreur retiré" },
    ]);
    await loadCommandes();
  }

  async function assignCloser(commandeId, nom) {
    await supabase.from("commandes").update({ closer: nom || null }).eq("id", commandeId);
    await supabase.from("relances").insert([
      { commande_id: commandeId, note: nom ? `🎧 Closer assigné : ${nom}` : "🎧 Closer retiré" },
    ]);
    await loadCommandes();
  }

  useEffect(() => {
    loadLivreurs();
    loadClosers();
    loadProduits();
  }, []);

  const accesBloque = (() => {
    if (subscription === undefined || subscription === null) return false; // pas encore chargé ou pas d'abonnement du tout (ancien workspace) : ne rien bloquer
    if (subscription.status === "active") return false;
    if (subscription.status === "trial") {
      const finEssai = new Date(subscription.trial_ends_at);
      return finEssai < new Date();
    }
    if (subscription.status === "suspended" || subscription.status === "cancelled") return true;
    return false;
  })();

  const maxCommandesMois = subscription?.subscription_plans?.max_commandes_mois ?? null;
  const commandesCeMois = commandes.filter((c) => {
    const d = new Date(c.created_at);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const quotaAtteint = maxCommandesMois !== null && commandesCeMois >= maxCommandesMois && !accesBloque;

  const knownOrderIds = React.useRef(null);

  function playNotifSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      function jouerChaChing(decalage) {
        const notes = [
          { freq: 987.77, start: decalage, dur: 0.16, vol: 0.55 },
          { freq: 1318.51, start: decalage + 0.1, dur: 0.32, vol: 0.6 },
          { freq: 1975.53, start: decalage + 0.1, dur: 0.32, vol: 0.25 },
        ];
        notes.forEach((n) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g);
          g.connect(ctx.destination);
          o.type = "sine";
          o.frequency.value = n.freq;
          const start = ctx.currentTime + n.start;
          g.gain.setValueAtTime(0, start);
          g.gain.linearRampToValueAtTime(n.vol, start + 0.015);
          g.gain.exponentialRampToValueAtTime(0.001, start + n.dur);
          o.start(start);
          o.stop(start + n.dur);
        });
      }
      jouerChaChing(0);
      jouerChaChing(0.55);
    } catch (e) {}
  }

  async function loadCommandes() {
    const { data, error } = await supabase
      .from("commandes")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false });
    if (!error) {
      const list = data || [];
      if (knownOrderIds.current !== null) {
        const nouvelles = list.filter((c) => !knownOrderIds.current.has(c.id));
        if (nouvelles.length > 0) playNotifSound();
      }
      knownOrderIds.current = new Set(list.map((c) => c.id));
      setCommandes(list);
    }
    setLoaded(true);
    loadAllRelances();
  }

  const [allRelances, setAllRelances] = useState([]);

  async function loadAllRelances() {
    const { data: cmds } = await supabase.from("commandes").select("id").eq("workspace_id", workspace.id);
    const ids = (cmds || []).map((c) => c.id);
    if (ids.length === 0) {
      setAllRelances([]);
      return;
    }
    const { data } = await supabase.from("relances").select("commande_id, created_at").in("commande_id", ids).order("created_at", { ascending: false });
    setAllRelances(data || []);
  }

  useEffect(() => {
    loadCommandes();
    loadAllRelances();

    // Détection instantanée des nouvelles commandes de CET espace uniquement
    const channel = supabase
      .channel(`commandes-${workspace.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "commandes", filter: `workspace_id=eq.${workspace.id}` },
        () => loadCommandes()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const relanceCountByOrder = useMemo(() => {
    const map = {};
    const lastByOrder = {};
    allRelances.forEach((r) => {
      map[r.commande_id] = (map[r.commande_id] || 0) + 1;
      if (!lastByOrder[r.commande_id] || new Date(r.created_at) > new Date(lastByOrder[r.commande_id])) {
        lastByOrder[r.commande_id] = r.created_at;
      }
    });
    return { count: map, last: lastByOrder };
  }, [allRelances]);

  const todoAujourdhui = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const now24hAgo = new Date(today.getTime() - 24 * 3600 * 1000);
    const byMontant = (a, b) => Number(b.montant) - Number(a.montant);

    const actives = commandes.filter((c) => c.statut === "en_cours" || c.statut === "echouee");

    const aRelivrer = actives.filter((c) => c.date_relivraison === todayStr).sort(byMontant);

    const jamaisContactees = actives
      .filter((c) => !relanceCountByOrder.count[c.id] && aRelivrer.every((a) => a.id !== c.id))
      .sort(byMontant);

    const sansNouvelles = actives
      .filter((c) => {
        if (aRelivrer.some((a) => a.id === c.id)) return false;
        if (jamaisContactees.some((j) => j.id === c.id)) return false;
        const last = relanceCountByOrder.last[c.id];
        if (!last) return false;
        return new Date(last) < now24hAgo;
      })
      .sort(byMontant);

    const total = aRelivrer.length + jamaisContactees.length + sansNouvelles.length;
    const echouees = commandes.filter((c) => c.statut === "echouee");
    const enCoursOuEchouee = commandes.filter((c) => c.statut === "en_cours" || c.statut === "echouee");
    const argentARisque = enCoursOuEchouee.reduce((s, c) => s + Number(c.montant), 0);
    const argentRecuperable = echouees.reduce((s, c) => s + Number(c.montant), 0);

    return { aRelivrer, jamaisContactees, sansNouvelles, total, argentARisque, argentRecuperable };
  }, [commandes, relanceCountByOrder]);

  const [vue, setVue] = useState("commandes");
  const [datePreset, setDatePreset] = useState("aujourdhui");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const dateRange = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start, end;
    if (datePreset === "aujourdhui") {
      start = startOfToday;
      end = new Date(startOfToday.getTime() + 86400000);
    } else if (datePreset === "hier") {
      start = new Date(startOfToday.getTime() - 86400000);
      end = startOfToday;
    } else if (datePreset === "semaine") {
      const day = startOfToday.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start = new Date(startOfToday.getTime() - diff * 86400000);
      end = new Date(now.getTime() + 60000);
    } else if (datePreset === "mois") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getTime() + 60000);
    } else if (datePreset === "personnalise" && customStart && customEnd) {
      start = new Date(customStart + "T00:00:00");
      end = new Date(customEnd + "T23:59:59");
    } else {
      start = new Date(0);
      end = new Date(now.getTime() + 60000);
    }
    return { start, end };
  }, [datePreset, customStart, customEnd]);

  const [recherche, setRecherche] = useState("");

  const commandesInRange = useMemo(() => {
    return commandes.filter((c) => {
      const d = new Date(c.created_at);
      return d >= dateRange.start && d < dateRange.end;
    });
  }, [commandes, dateRange]);

  const [filterStatut, setFilterStatut] = useState("toutes");

  const commandesAffichees = useMemo(() => {
    let r = commandesInRange;
    if (filterStatut !== "toutes") r = r.filter((c) => c.statut === filterStatut);
    if (recherche.trim()) {
      const q = recherche.trim().toLowerCase();
      r = r.filter((c) => (c.client || "").toLowerCase().includes(q) || (c.tel || "").includes(q));
    }
    return r;
  }, [commandesInRange, recherche, filterStatut]);

  const groupedByDay = useMemo(() => {
    const groups = {};
    commandesAffichees.forEach((c) => {
      const d = new Date(c.created_at);
      const dayKey = d.toISOString().slice(0, 10);
      if (!groups[dayKey]) {
        groups[dayKey] = { label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), orders: [] };
      }
      groups[dayKey].orders.push(c);
    });
    return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([, val]) => val);
  }, [commandesAffichees]);

  function exportCSV() {
    const headers = ["Client", "Téléphone", "Produit", "Montant", "Zone", "Statut", "Livreur", "Date"];
    const rows = commandesAffichees.map((c) => [
      c.client, c.tel, c.produit, c.montant, c.zone || "", STATUTS[c.statut]?.label || c.statut, c.livreur || "", new Date(c.created_at).toLocaleDateString("fr-FR"),
    ]);
    function neutraliser(valeur) {
      const s = String(valeur ?? "");
      // Empêche l'injection de formule (=, +, -, @ en début de cellule) si le fichier est ouvert dans Excel
      if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
      return s;
    }
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${neutraliser(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workspace.name}-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const periodLabel = { aujourdhui: "Aujourd'hui", hier: "Hier", semaine: "Cette semaine", mois: "Ce mois", personnalise: "Période personnalisée" }[datePreset];

  const quantitesParProduit = useMemo(() => {
    const map = {};
    commandes.forEach((c) => {
      const { nom, quantite } = parseProduitTexte(c.produit);
      if (!nom) return;
      if (!map[nom]) map[nom] = { commandees: 0, livrees: 0 };
      if (c.statut !== "echouee") map[nom].commandees += quantite;
      if (c.statut === "confirmee") map[nom].livrees += quantite;
    });
    return map;
  }, [commandes]);

  const evolutionData = useMemo(() => {
    const map = {};
    commandesInRange.forEach((c) => {
      const d = new Date(c.created_at);
      const key = d.toISOString().slice(0, 10);
      if (!map[key]) map[key] = { date: key, commandes: 0, label: d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) };
      map[key].commandes += 1;
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [commandesInRange]);

  const anomaliesProduitZone = useMemo(() => {
    const traites = commandes.filter((c) => c.statut === "confirmee" || c.statut === "echouee");

    const globalParProduit = {};
    traites.forEach((c) => {
      const p = (c.produit || "").split(" x")[0].trim();
      if (!p) return;
      if (!globalParProduit[p]) globalParProduit[p] = { total: 0, echecs: 0 };
      globalParProduit[p].total += 1;
      if (c.statut === "echouee") globalParProduit[p].echecs += 1;
    });

    const parProduitZone = {};
    traites.forEach((c) => {
      const p = (c.produit || "").split(" x")[0].trim();
      const z = (c.zone || "").trim();
      if (!p || !z) return;
      const key = p + "|||" + z;
      if (!parProduitZone[key]) parProduitZone[key] = { produit: p, zone: z, total: 0, echecs: 0 };
      parProduitZone[key].total += 1;
      if (c.statut === "echouee") parProduitZone[key].echecs += 1;
    });

    const anomalies = [];
    Object.values(parProduitZone).forEach((g) => {
      if (g.total < 5) return;
      const tauxLocal = g.echecs / g.total;
      const global = globalParProduit[g.produit];
      const tauxGlobal = global && global.total > 0 ? global.echecs / global.total : 0;
      const ecartPoints = (tauxLocal - tauxGlobal) * 100;
      if (ecartPoints >= 15 && tauxLocal >= tauxGlobal * 1.5) {
        anomalies.push({ produit: g.produit, zone: g.zone, total: g.total, tauxLocal: Math.round(tauxLocal * 100), tauxGlobal: Math.round(tauxGlobal * 100) });
      }
    });

    return anomalies.sort((a, b) => b.tauxLocal - a.tauxLocal);
  }, [commandes]);

  const clients = useMemo(() => {
    const map = {};
    commandes.forEach((c) => {
      const key = c.tel || c.client;
      if (!map[key]) map[key] = { nom: c.client, tel: c.tel, zone: c.zone, commandes: [] };
      map[key].commandes.push(c);
    });
    return Object.values(map)
      .map((cl) => {
        const confirmeesTriees = cl.commandes
          .filter((c) => c.statut === "confirmee")
          .map((c) => new Date(c.created_at))
          .sort((a, b) => a - b);

        let intervalleMoyen = null;
        let joursDepuisDernier = null;
        let joursDeRetard = null;
        if (confirmeesTriees.length >= 2) {
          const intervalles = [];
          for (let i = 1; i < confirmeesTriees.length; i++) {
            intervalles.push((confirmeesTriees[i] - confirmeesTriees[i - 1]) / 86400000);
          }
          intervalleMoyen = Math.round(intervalles.reduce((s, v) => s + v, 0) / intervalles.length);
          const dernier = confirmeesTriees[confirmeesTriees.length - 1];
          joursDepuisDernier = Math.round((new Date() - dernier) / 86400000);
          joursDeRetard = joursDepuisDernier - intervalleMoyen;
        }

        return {
          ...cl,
          total: cl.commandes.length,
          confirmees: cl.commandes.filter((c) => c.statut === "confirmee").length,
          echouees: cl.commandes.filter((c) => c.statut === "echouee").length,
          montantTotal: cl.commandes.filter((c) => c.statut === "confirmee").reduce((s, c) => s + Number(c.montant), 0),
          intervalleMoyen,
          joursDepuisDernier,
          joursDeRetard,
        };
      })
      .sort((a, b) => b.montantTotal - a.montantTotal);
  }, [commandes]);

  const clientsARelancer = useMemo(() => {
    return clients.filter((c) => c.joursDeRetard !== null && c.joursDeRetard >= 0).sort((a, b) => b.joursDeRetard - a.joursDeRetard);
  }, [clients]);

  async function addCommande(form) {
    if (accesBloque) {
      alert("Ton essai gratuit est terminé. Passe à un plan payant pour continuer à ajouter des commandes.");
      return;
    }
    if (quotaAtteint) {
      alert("Quota de commandes du mois atteint pour ton plan. Passe à un plan supérieur pour continuer.");
      return;
    }
    const { error } = await supabase.from("commandes").insert([
      { ...form, montant: Number(form.montant), workspace_id: workspace.id },
    ]);
    if (error) {
      alert("Erreur: " + error.message);
      return;
    }
    await loadCommandes();
    setShowAdd(false);
  }

  const totalCA = commandesInRange.reduce((s, c) => s + Number(c.montant), 0);
  const confirmees = commandesInRange.filter((c) => c.statut === "confirmee");
  const caConfirme = confirmees.reduce((s, c) => s + Number(c.montant), 0);
  const echoueesInRange = commandesInRange.filter((c) => c.statut === "echouee");
  const enCoursInRange = commandesInRange.filter((c) => c.statut === "en_cours");
  const aRisqueCount = echoueesInRange.length + enCoursInRange.length;
  const tauxLivraison = commandesInRange.length ? Math.round((confirmees.length / commandesInRange.length) * 100) : 0;
  const tauxEchec = commandesInRange.length ? Math.round((echoueesInRange.length / commandesInRange.length) * 100) : 0;

  const COUT_LIVRAISON = 1500;
  const coutLivraisons = confirmees.length * COUT_LIVRAISON;

  const coutProduitsInfo = useMemo(() => {
    let coutTotal = 0;
    let nbInconnu = 0;
    let montantInconnu = 0;
    confirmees.forEach((c) => {
      const { nom, quantite } = parseProduitTexte(c.produit);
      const trouve = produits.find((p) => p.nom.toLowerCase() === nom.toLowerCase());
      if (!trouve) {
        nbInconnu += 1;
        montantInconnu += Number(c.montant);
      } else {
        coutTotal += trouve.cout_achat * quantite;
      }
    });
    return { coutTotal, nbInconnu, montantInconnu };
  }, [confirmees, produits]);

  const beneficeReel = caConfirme - coutLivraisons - coutProduitsInfo.coutTotal;

  const depotsParLivreur = useMemo(() => {
    return livreurs
      .map((l) => {
        const mesLivrees = confirmees.filter((c) => c.livreur === l.nom);
        const montantRecupere = mesLivrees.reduce((s, c) => s + Number(c.montant), 0);
        const commission = mesLivrees.length * COUT_LIVRAISON;
        return { nom: l.nom, livrees: mesLivrees.length, montantRecupere, commission, aDeposer: montantRecupere - commission };
      })
      .filter((l) => l.livrees > 0)
      .sort((a, b) => b.aDeposer - a.aDeposer);
  }, [livreurs, confirmees]);

  const totalCommission = depotsParLivreur.reduce((s, l) => s + l.commission, 0);
  const totalADeposer = depotsParLivreur.reduce((s, l) => s + l.aDeposer, 0);

  const repartitionCloserLivreur = useMemo(() => {
    const map = {};
    commandesInRange.forEach((c) => {
      if (!c.closer || !c.livreur) return;
      const key = c.closer + "|||" + c.livreur;
      if (!map[key]) map[key] = { closer: c.closer, livreur: c.livreur, total: 0, produits: {} };
      map[key].total += 1;
      const { nom, quantite } = parseProduitTexte(c.produit);
      if (nom) map[key].produits[nom] = (map[key].produits[nom] || 0) + quantite;
    });
    return Object.values(map)
      .map((r) => ({ ...r, produitsListe: Object.entries(r.produits).map(([nom, qte]) => ({ nom, qte })).sort((a, b) => b.qte - a.qte) }))
      .sort((a, b) => b.total - a.total);
  }, [commandesInRange]);

  const livreursAvecCommandes = useMemo(() => {
    const map = {};
    commandesInRange.forEach((c) => {
      if (!c.livreur) return;
      map[c.livreur] = (map[c.livreur] || 0) + 1;
    });
    return Object.entries(map).map(([nom, total]) => ({ nom, total })).sort((a, b) => b.total - a.total);
  }, [commandesInRange]);

  const monProfilLivreur = livreurs.find((l) => l.email && l.email.toLowerCase() === session.user.email.toLowerCase());

  if (workspace.role === "livreur" && monProfilLivreur) {
    return (
      <LivreurPortalSaas
        livreur={monProfilLivreur}
        commandes={commandes.filter((c) => c.livreur === monProfilLivreur.nom)}
        currency={workspace.currency}
        onStatusChanged={loadCommandes}
      />
    );
  }

  if (workspace.role === "comptable") {
    return (
      <ComptablePortalSaas
        workspace={workspace}
        beneficeReel={beneficeReel}
        caConfirme={caConfirme}
        confirmees={confirmees}
        coutLivraisons={coutLivraisons}
        coutProduitsInfo={coutProduitsInfo}
        COUT_LIVRAISON={COUT_LIVRAISON}
        depotsParLivreur={depotsParLivreur}
        totalCommission={totalCommission}
        totalADeposer={totalADeposer}
        livreurs={livreurs}
      />
    );
  }

  const monProfilCloser = closers.find((c) => c.email && c.email.toLowerCase() === session.user.email.toLowerCase());

  if (workspace.role === "closer" && monProfilCloser) {
    return (
      <CloserPortalSaas
        closer={monProfilCloser}
        commandes={commandes}
        currency={workspace.currency}
        workspace={workspace}
        onStatusChanged={loadCommandes}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF7", fontFamily: "'IBM Plex Sans', sans-serif", padding: 24 }}>
      <style>{`
        .rv-mesh-blob { position: absolute; border-radius: 50%; filter: blur(40px); pointer-events: none; }
        .rv-mesh-1 { width: 180px; height: 180px; background: radial-gradient(circle, rgba(232,146,10,0.45) 0%, rgba(232,146,10,0) 70%); top: -60px; right: -40px; animation: rvMeshFloat1 9s ease-in-out infinite; }
        .rv-mesh-2 { width: 140px; height: 140px; background: radial-gradient(circle, rgba(127,214,163,0.4) 0%, rgba(127,214,163,0) 70%); bottom: -50px; left: 10%; animation: rvMeshFloat2 11s ease-in-out infinite; }
        .rv-mesh-3 { width: 110px; height: 110px; background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%); top: 20%; right: 25%; animation: rvMeshFloat3 7s ease-in-out infinite; }
        @keyframes rvMeshFloat1 { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-20px,20px) scale(1.15); } }
        @keyframes rvMeshFloat2 { 0%, 100% { transform: translate(0,0) scale(1); } 50% { transform: translate(25px,-15px) scale(1.1); } }
        @keyframes rvMeshFloat3 { 0%, 100% { transform: translate(0,0) scale(1); opacity: 0.6; } 50% { transform: translate(-15px,-10px) scale(1.3); opacity: 1; } }
        .rv-wave-1 { animation: rvWaveDrift 9s linear infinite; }
        .rv-wave-2 { animation: rvWaveDrift 14s linear infinite reverse; }
        .rv-wave-3 { animation: rvWaveDrift 20s linear infinite; }
        @keyframes rvWaveDrift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .rv-glow { animation: rvGlowBreathe 4s ease-in-out infinite; }
        @keyframes rvGlowBreathe { 0%, 100% { opacity: 0.5; transform: scale(1); } 50% { opacity: 1; transform: scale(1.15); } }
        .rv-3d-card { animation: rv3DFloat 6s ease-in-out infinite; transform-style: preserve-3d; }
        .rv-glass-card { position: relative; overflow: hidden; border-radius: 12px; padding: 11px 13px; background: linear-gradient(155deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0.1) 100%); border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 4px 14px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 0 rgba(0,0,0,0.08); }
        .rv-glass-shine { position: absolute; top: -50%; left: -60%; width: 60%; height: 200%; background: linear-gradient(120deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%); transform: rotate(20deg); animation: rvShineSweep 3.5s ease-in-out infinite; pointer-events: none; }
        @keyframes rvShineSweep { 0% { left: -60%; } 35%, 100% { left: 140%; } }
        @keyframes rv3DFloat {
          0%, 100% { transform: rotateX(0deg) rotateY(0deg) translateZ(0); }
          25% { transform: rotateX(3deg) rotateY(-4deg) translateZ(6px); }
          50% { transform: rotateX(0deg) rotateY(0deg) translateZ(0); }
          75% { transform: rotateX(-3deg) rotateY(4deg) translateZ(6px); }
        }
        .rv-livedot { animation: rvPulseDot 2s ease-in-out infinite; }
        @keyframes rvPulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .rv-saas-sidebar { display: none; }
        .rv-saas-content { }
        .rv-saas-tabs-mobile { }
        @media (min-width: 900px) {
          .rv-saas-sidebar {
            display: flex;
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            width: 220px;
            background: #16231F;
            flex-direction: column;
            padding: 24px 14px;
            z-index: 30;
          }
          .rv-saas-content {
            margin-left: 220px;
            max-width: none;
            padding: 0 32px;
          }
          .rv-saas-tabs-mobile { display: none !important; }
        }
      `}</style>

      <div className="rv-saas-sidebar">
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 18, color: "white", marginBottom: 28, padding: "0 8px" }}>
          RECU<span style={{ color: "#e8920a" }}>VENTE</span>
        </div>
        {[
          { key: "aujourdhui", label: "Aujourd'hui" },
          { key: "commandes", label: "Commandes" },
          { key: "clients", label: "Clients" },
          ...(workspace.role === "owner" || workspace.role === "admin" ? [{ key: "compta", label: "🧮 Compta" }] : []),
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setVue(t.key)}
            style={{
              display: "flex", alignItems: "center", padding: "11px 12px", borderRadius: 9, border: "none",
              background: vue === t.key ? "rgba(255,255,255,0.1)" : "transparent",
              color: vue === t.key ? "white" : "rgba(255,255,255,0.6)",
              fontSize: 14, fontWeight: vue === t.key ? 600 : 500, textAlign: "left", marginBottom: 3, cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
        <div style={{ marginTop: "auto" }}>
          <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", padding: "8px 0", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.6)", fontWeight: 500, fontSize: 12.5, cursor: "pointer" }}>
            Déconnexion
          </button>
        </div>
      </div>

      <div className="rv-saas-content">

      <div style={{ background: "#1a7a3c", color: "white", padding: "20px 20px 34px", borderRadius: 14, marginBottom: 20, position: "relative", overflow: "hidden" }}>
        <div className="rv-mesh-blob rv-mesh-1" />
        <div className="rv-mesh-blob rv-mesh-2" />
        <div className="rv-mesh-blob rv-mesh-3" />

        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 55, overflow: "hidden", pointerEvents: "none" }}>
          <svg className="rv-wave-1" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", bottom: -5, width: "200%", height: 45 }}>
            <path d="M0,30 C40,10 80,50 120,30 C160,10 200,50 240,30 C280,10 320,50 360,30 C380,20 390,25 400,30 L400,60 L0,60 Z" fill="rgba(232,146,10,0.4)" />
          </svg>
          <svg className="rv-wave-2" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", bottom: -8, width: "200%", height: 38 }}>
            <path d="M0,25 C50,45 90,5 140,25 C190,45 230,5 280,25 C330,45 370,5 400,20 L400,60 L0,60 Z" fill="rgba(255,255,255,0.28)" />
          </svg>
          <svg className="rv-wave-3" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", bottom: -3, width: "200%", height: 32 }}>
            <path d="M0,35 C60,15 100,45 160,25 C220,5 260,45 320,25 C360,10 380,30 400,25 L400,60 L0,60 Z" fill="rgba(248,180,60,0.28)" />
          </svg>
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 13, opacity: 0.8 }}>Espace de</span>
            <span className="rv-livedot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#7fd6a3", display: "inline-block", marginLeft: 4 }} />
            <span style={{ fontSize: 9.5, fontWeight: 500, opacity: 0.65 }}>EN DIRECT</span>
          </div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 700 }}>{workspace.name}</div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
            {workspace.country} · {workspace.currency} · rôle : {workspace.role}
          </div>

          <div style={{ marginTop: 16, perspective: "800px" }}>
            <div className="rv-3d-card" style={{ position: "relative", padding: "14px 16px", borderRadius: 14, background: "linear-gradient(155deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 70%)", border: "1px solid rgba(255,255,255,0.18)", boxShadow: "0 10px 24px rgba(0,0,0,0.2)" }}>
              <div className="rv-glow" style={{ position: "absolute", top: -16, left: -16, width: 100, height: 100, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,146,10,0.35) 0%, rgba(232,146,10,0) 70%)", pointerEvents: "none" }} />
              <div style={{ fontSize: 12, opacity: 0.85, textTransform: "uppercase", letterSpacing: "0.04em", position: "relative" }}>Argent récupéré</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 32, fontWeight: 700, color: "#e8920a", marginTop: 4, position: "relative" }}>{caConfirme.toLocaleString("fr-FR")} {workspace.currency}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <div className="rv-glass-card" style={{ flex: 1, minWidth: 0 }}>
              <div className="rv-glass-shine" />
              <div style={{ fontSize: 10.5, opacity: 0.75, position: "relative", minHeight: 28, display: "flex", alignItems: "center" }}>À risque</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, position: "relative" }}>{aRisqueCount}</div>
            </div>
            <div className="rv-glass-card" style={{ flex: 1, minWidth: 0 }}>
              <div className="rv-glass-shine" />
              <div style={{ fontSize: 10.5, opacity: 0.75, position: "relative", minHeight: 28, display: "flex", alignItems: "center" }}>Taux livraison</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, position: "relative" }}>{tauxLivraison}%</div>
            </div>
            <div className="rv-glass-card" style={{ flex: 1, minWidth: 0 }}>
              <div className="rv-glass-shine" />
              <div style={{ fontSize: 10.5, opacity: 0.75, position: "relative", minHeight: 28, display: "flex", alignItems: "center" }}>Total</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, position: "relative" }}>{commandesInRange.length}</div>
            </div>
          </div>

          {(workspace.role === "owner" || workspace.role === "admin") && (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {workspace.role === "owner" && (
                <>
                  <button onClick={() => setShowTeam(true)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                    👥 Gérer l'équipe
                  </button>
                  <button onClick={() => setShowAbonnement(true)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                    💳 Mon abonnement
                  </button>
                </>
              )}
              <button onClick={() => setShowLivreurs(true)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                🚚 Livreurs
              </button>
              <button onClick={() => setShowClosers(true)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                🎧 Closers
              </button>
              <button onClick={() => setShowCampagne(true)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                📣 Campagne
              </button>
            </div>
          )}
        </div>
      </div>

      <SubscriptionBanner subscription={subscription} />

      {(vue === "commandes" || vue === "compta") && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 2 }}>
          {[
            { key: "aujourdhui", label: "Aujourd'hui" },
            { key: "hier", label: "Hier" },
            { key: "semaine", label: "Cette semaine" },
            { key: "mois", label: "Ce mois" },
            { key: "personnalise", label: "Personnalisé" },
          ].map((d) => (
            <button
              key={d.key}
              onClick={() => setDatePreset(d.key)}
              style={{ padding: "6px 12px", borderRadius: 999, border: `1px solid ${datePreset === d.key ? "#1a7a3c" : "#DDD8CC"}`, background: datePreset === d.key ? "#1a7a3c" : "white", color: datePreset === d.key ? "white" : "#16231F", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", cursor: "pointer" }}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {vue === "commandes" && datePreset === "personnalise" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ flex: 1, padding: "7px 9px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 12.5 }} />
          <span style={{ color: "#8A9089", fontSize: 12 }}>à</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ flex: 1, padding: "7px 9px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 12.5 }} />
        </div>
      )}

      <div className="rv-saas-tabs-mobile" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => setVue("aujourdhui")}
          style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${vue === "aujourdhui" ? "#1a7a3c" : "#DDD8CC"}`, background: vue === "aujourdhui" ? "#1a7a3c" : "white", color: vue === "aujourdhui" ? "white" : "#16231F", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          Aujourd'hui
        </button>
        <button
          onClick={() => setVue("commandes")}
          style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${vue === "commandes" ? "#1a7a3c" : "#DDD8CC"}`, background: vue === "commandes" ? "#1a7a3c" : "white", color: vue === "commandes" ? "white" : "#16231F", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          Commandes
        </button>
        <button
          onClick={() => setVue("clients")}
          style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${vue === "clients" ? "#1a7a3c" : "#DDD8CC"}`, background: vue === "clients" ? "#1a7a3c" : "white", color: vue === "clients" ? "white" : "#16231F", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          Clients ({clients.length})
        </button>
        {(workspace.role === "owner" || workspace.role === "admin") && (
          <button
            onClick={() => setVue("compta")}
            style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${vue === "compta" ? "#1a7a3c" : "#DDD8CC"}`, background: vue === "compta" ? "#1a7a3c" : "white", color: vue === "compta" ? "white" : "#16231F", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
          >
            🧮 Compta
          </button>
        )}
      </div>

      {vue === "aujourdhui" && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Aujourd'hui</div>
          <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 14 }}>
            {todoAujourdhui.total > 0 ? `${todoAujourdhui.total} commande${todoAujourdhui.total > 1 ? "s" : ""} à traiter` : "Rien à traiter, tout est à jour ✅"}
          </div>

          {(todoAujourdhui.argentARisque > 0 || todoAujourdhui.argentRecuperable > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
              <div style={{ background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 10.5, color: "#B23A22", textTransform: "uppercase", fontWeight: 600 }}>💸 Argent à risque</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, marginTop: 3, color: "#D64933" }}>{todoAujourdhui.argentARisque.toLocaleString("fr-FR")} {workspace.currency}</div>
              </div>
              <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 10.5, color: "#8A6412", textTransform: "uppercase", fontWeight: 600 }}>♻️ Récupérable</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, marginTop: 3, color: "#8A6412" }}>{todoAujourdhui.argentRecuperable.toLocaleString("fr-FR")} {workspace.currency}</div>
              </div>
            </div>
          )}

          {todoAujourdhui.total === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#8A9089" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🎉</div>
              <div style={{ fontSize: 14 }}>Aucune commande urgente pour le moment.</div>
            </div>
          )}

          {[
            { key: "aRelivrer", title: "📅 À relivrer aujourd'hui", items: todoAujourdhui.aRelivrer, color: "#1a7a3c" },
            { key: "jamaisContactees", title: "🆕 Jamais contactées", items: todoAujourdhui.jamaisContactees, color: "#8A6412" },
            { key: "sansNouvelles", title: "⏰ Sans nouvelles depuis 24h+", items: todoAujourdhui.sansNouvelles, color: "#D64933" },
          ].map((sec) => sec.items.length > 0 && (
            <div key={sec.key} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: sec.color, marginBottom: 8 }}>{sec.title} ({sec.items.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sec.items.map((c, i) => (
                  <div key={c.id} style={{ background: "white", border: "1px solid #ECE8DC", borderLeft: `4px solid ${sec.color}`, borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: i === 0 ? sec.color : "#ECE8DC", color: i === 0 ? "white" : "#8A9089", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {i + 1}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{c.client}</div>
                      <div style={{ fontSize: 12, color: "#6B7168" }}>{c.produit} · {c.tel}</div>
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 14 }}>{Number(c.montant).toLocaleString("fr-FR")} {workspace.currency}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {vue === "commandes" && (
      <>
      {accesBloque && (
        <div style={{ background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "#D64933" }}>
          🔒 Impossible d'ajouter de nouvelles commandes tant que l'abonnement n'est pas actif. Tes données existantes restent accessibles et en sécurité.
        </div>
      )}

      {quotaAtteint && (
        <div style={{ background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "#D64933" }}>
          🔒 Quota du plan atteint ({commandesCeMois}/{maxCommandesMois} commandes ce mois-ci). Passe à un plan supérieur pour continuer.
        </div>
      )}

      {!accesBloque && !quotaAtteint && maxCommandesMois !== null && (
        <div style={{ fontSize: 11.5, color: "#8A9089", marginBottom: 10 }}>
          {commandesCeMois} / {maxCommandesMois} commandes utilisées ce mois-ci
        </div>
      )}

      {commandesInRange.length > 0 && (
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 14, padding: "16px 18px", marginBottom: 16, display: "flex", alignItems: "center", gap: 20 }}>
          <StatusDonutSaas
            livrees={commandesInRange.filter((c) => c.statut === "confirmee").length}
            enAttente={commandesInRange.filter((c) => c.statut === "en_cours").length}
            echouees={commandesInRange.filter((c) => c.statut === "echouee").length}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#1F9D6E", display: "inline-block" }} />
              Confirmées <span style={{ marginLeft: "auto", fontWeight: 600 }}>{commandesInRange.filter((c) => c.statut === "confirmee").length}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#E8A93D", display: "inline-block" }} />
              En cours <span style={{ marginLeft: "auto", fontWeight: 600 }}>{commandesInRange.filter((c) => c.statut === "en_cours").length}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#D64933", display: "inline-block" }} />
              Échouées <span style={{ marginLeft: "auto", fontWeight: 600 }}>{commandesInRange.filter((c) => c.statut === "echouee").length}</span>
            </div>
          </div>
        </div>
      )}

      {evolutionData.length > 1 && (
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 14, padding: "18px 20px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>Évolution des commandes</div>
          <EvolutionChartSaas data={evolutionData} />
        </div>
      )}

      {anomaliesProduitZone.length > 0 && (
        <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#8A6412", marginBottom: 8 }}>
            📍 {anomaliesProduitZone.length} produit{anomaliesProduitZone.length > 1 ? "s" : ""} échoue{anomaliesProduitZone.length > 1 ? "nt" : ""} anormalement dans une zone précise
          </div>
          {anomaliesProduitZone.slice(0, 3).map((a, i) => (
            <div key={i} style={{ fontSize: 12, color: "#8A6412", marginBottom: 3 }}>
              <strong>{a.produit}</strong> à <strong>{a.zone}</strong> — {a.tauxLocal}% d'échec ici (contre {a.tauxGlobal}% ailleurs, sur {a.total} commandes)
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: "#8A6412", marginTop: 4, opacity: 0.8 }}>
            Vérifie l'adresse, le livreur assigné, ou la disponibilité du produit dans cette zone.
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un client ou numéro..."
          style={{ flex: 1, padding: "9px 12px", borderRadius: 9, border: "1px solid #DDD8CC", fontSize: 13.5, background: "white", boxSizing: "border-box" }}
        />
        <button
          onClick={exportCSV}
          style={{ background: "white", border: "1px solid #DDD8CC", borderRadius: 9, padding: "0 13px", color: "#1a7a3c", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap", cursor: "pointer" }}
        >
          Exporter
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto" }}>
        {[
          { key: "toutes", label: "Toutes" },
          { key: "echouee", label: "Échouées" },
          { key: "en_cours", label: "En cours" },
          { key: "confirmee", label: "Confirmées" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilterStatut(f.key)}
            style={{ padding: "7px 14px", borderRadius: 999, border: `1px solid ${filterStatut === f.key ? "#1a7a3c" : "#DDD8CC"}`, background: filterStatut === f.key ? "#1a7a3c" : "white", color: filterStatut === f.key ? "white" : "#16231F", fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", cursor: "pointer" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>Commandes ({commandesAffichees.length})</div>
        <button
          onClick={() => !accesBloque && !quotaAtteint && setShowAdd(true)}
          disabled={accesBloque || quotaAtteint}
          style={{ ...btnStyle, width: "auto", padding: "8px 16px", opacity: (accesBloque || quotaAtteint) ? 0.4 : 1, cursor: (accesBloque || quotaAtteint) ? "not-allowed" : "pointer" }}
        >
          + Ajouter
        </button>
      </div>

      {!loaded && <div style={{ color: "#8A9089", fontSize: 13 }}>Chargement...</div>}
      {loaded && commandes.length === 0 && (
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: 20, textAlign: "center", color: "#8A9089", fontSize: 13 }}>
          Aucune commande. Ajoute la première pour tester.
        </div>
      )}

      {commandesAffichees.length === 0 && commandes.length > 0 && (
        <div style={{ textAlign: "center", padding: "30px 0", color: "#8A9089", fontSize: 13 }}>Aucune commande ne correspond.</div>
      )}

      {groupedByDay.map((group, gi) => (
        <div key={gi} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1a7a3c", textTransform: "capitalize", padding: "8px 2px" }}>
            {group.label} <span style={{ color: "#8A9089", fontWeight: 500 }}>({group.orders.length})</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {group.orders.map((c) => (
              <CommandeCard key={c.id} commande={c} currency={workspace.currency} onStatusChanged={loadCommandes} livreurs={livreurs} closers={closers} onAssignLivreur={assignLivreur} onAssignCloser={assignCloser} workspace={workspace} confirmateurNom={session.user.email.split("@")[0]} />
            ))}
          </div>
        </div>
      ))}
      </>
      )}

      {vue === "clients" && (
        <div>
          {clientsARelancer.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#1a7a3c", marginBottom: 3 }}>🔄 Clients à relancer pour réachat ({clientsARelancer.length})</div>
              <div style={{ fontSize: 11.5, color: "#8A9089", marginBottom: 8 }}>Basé sur leur rythme d'achat habituel.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {clientsARelancer.slice(0, 10).map((c, i) => (
                  <a
                    key={i}
                    href={`https://wa.me/${cleanPhoneForWhatsApp(c.tel)}?text=${encodeURIComponent(`Bonjour ${(c.nom || "").split(" ")[0]} 👋, ça faisait un moment ! Seriez-vous intéressé(e) pour recommander chez ${workspace.name} ?`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ background: "white", border: "1px solid #ECE8DC", borderLeft: "4px solid #1a7a3c", borderRadius: 10, padding: "10px 12px", display: "block", textDecoration: "none", color: "inherit" }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.nom}</div>
                    <div style={{ fontSize: 11.5, color: "#6B7168" }}>Achète en général tous les {c.intervalleMoyen}j · dernier achat il y a {c.joursDepuisDernier}j</div>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {clients.length === 0 && <div style={{ color: "#8A9089", fontSize: 13, textAlign: "center", padding: "30px 0" }}>Aucun client pour l'instant.</div>}
            {clients.map((cl, i) => (
              <div key={i} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {cl.joursDeRetard !== null && cl.joursDeRetard >= 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#1a7a3c", background: "#EAF3DE", padding: "1px 7px", borderRadius: 999 }}>🔄</span>}
                    {cl.nom}
                  </div>
                  <div style={{ fontSize: 12, color: "#6B7168" }}>{cl.tel} · {cl.zone}</div>
                  <div style={{ fontSize: 11.5, marginTop: 3, display: "flex", gap: 8 }}>
                    <span style={{ color: "#1a7a3c" }}>{cl.confirmees} confirmée{cl.confirmees > 1 ? "s" : ""}</span>
                    {cl.echouees > 0 && <span style={{ color: "#D64933" }}>{cl.echouees} échouée{cl.echouees > 1 ? "s" : ""}</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#1a7a3c" }}>{cl.montantTotal.toLocaleString("fr-FR")} {workspace.currency}</div>
                  <div style={{ fontSize: 10.5, color: "#8A9089" }}>{cl.total} commande{cl.total > 1 ? "s" : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {vue === "compta" && (
        <div>
          <div style={{ display: "inline-block", fontSize: 11, fontWeight: 600, color: "#1a7a3c", background: "#EAF3DE", padding: "3px 10px", borderRadius: 999, marginBottom: 12 }}>
            📊 {periodLabel}
          </div>
          <div style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 14, padding: "16px 18px", marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>💰 Bénéfice réel</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 24, color: beneficeReel >= 0 ? "#7fd6a3" : "#f0a0a0", marginTop: 3 }}>
              {beneficeReel.toLocaleString("fr-FR")} {workspace.currency}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
              CA confirmé {caConfirme.toLocaleString("fr-FR")} − Livraisons ({confirmees.length} × {COUT_LIVRAISON.toLocaleString("fr-FR")}) − Produits ({coutProduitsInfo.coutTotal.toLocaleString("fr-FR")})
            </div>
          </div>

          {coutProduitsInfo.nbInconnu > 0 && (
            <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#8A6412" }}>
              ⚠️ {coutProduitsInfo.nbInconnu} commande{coutProduitsInfo.nbInconnu > 1 ? "s" : ""} ({coutProduitsInfo.montantInconnu.toLocaleString("fr-FR")} {workspace.currency}) sans coût produit connu — non déduites, bénéfice sous-estimé.
              <button onClick={() => setShowProduits(true)} style={{ display: "block", marginTop: 6, background: "#1a7a3c", color: "white", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>
                📦 Renseigner le catalogue
              </button>
            </div>
          )}

          <button onClick={() => setShowProduits(true)} style={{ width: "100%", background: "white", border: "1px solid #DDD8CC", borderRadius: 10, padding: "10px 0", fontSize: 13, fontWeight: 600, color: "#16231F", cursor: "pointer", marginBottom: 16 }}>
            📦 Gérer le catalogue produits ({produits.length})
          </button>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            <div style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>💵 À payer aux livreurs</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, color: "#e8920a", marginTop: 3 }}>{totalCommission.toLocaleString("fr-FR")} {workspace.currency}</div>
            </div>
            <div style={{ background: "linear-gradient(135deg, #1a7a3c, #1F9D6E)", borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.75)", textTransform: "uppercase" }}>🏦 Dépôt attendu</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, color: "white", marginTop: 3 }}>{totalADeposer.toLocaleString("fr-FR")} {workspace.currency}</div>
            </div>
          </div>

          {livreurs.some((l) => l.en_tournee) && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>🟢 Livreurs en tournée</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {livreurs.filter((l) => l.en_tournee).map((l) => (
                  <div key={l.id} style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{l.nom}</span>
                    {l.position_lat && l.position_lng ? (
                      <a href={`https://www.google.com/maps?q=${l.position_lat},${l.position_lng}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#1a7a3c", fontWeight: 600 }}>
                        📍 Voir sur la carte
                      </a>
                    ) : (
                      <span style={{ fontSize: 11.5, color: "#8A9089" }}>Position en attente...</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Détail par livreur</div>
          {depotsParLivreur.length === 0 && <div style={{ color: "#8A9089", fontSize: 13 }}>Aucune livraison confirmée pour l'instant.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {depotsParLivreur.map((l) => (
              <div key={l.nom} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{l.nom}</div>
                <div style={{ fontSize: 11.5, color: "#6B7168", marginTop: 2 }}>{l.livrees} livraison{l.livrees > 1 ? "s" : ""} · {l.montantRecupere.toLocaleString("fr-FR")} {workspace.currency} encaissé</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <div style={{ flex: 1, background: "#FBF3E3", borderRadius: 7, padding: "6px 9px", fontSize: 11, color: "#8A6412" }}>
                    Commission : <strong>{l.commission.toLocaleString("fr-FR")}</strong>
                  </div>
                  <div style={{ flex: 1, background: "#EAF3DE", borderRadius: 7, padding: "6px 9px", fontSize: 11, color: "#3B6D11" }}>
                    À déposer : <strong>{l.aDeposer.toLocaleString("fr-FR")}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {livreursAvecCommandes.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>📊 Résumé — commandes reçues par livreur ({periodLabel})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {livreursAvecCommandes.map((l) => (
                  <div key={l.nom} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 8, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13 }}><strong>{l.nom}</strong> a reçu</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 14, color: "#1a7a3c" }}>{l.total} commande{l.total > 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {repartitionCloserLivreur.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>🔄 Répartition Closer → Livreur ({periodLabel})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {repartitionCloserLivreur.map((r, i) => (
                  <RepartitionLigne key={i} r={r} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <button onClick={() => supabase.auth.signOut()} className="rv-saas-tabs-mobile" style={{ ...btnStyle, marginTop: 20, background: "white", color: "#16231F", border: "1px solid #DDD8CC" }}>
        Déconnexion
      </button>

      </div>

      {showAdd && <AddCommandeModal onClose={() => setShowAdd(false)} onAdd={addCommande} currency={workspace.currency} />}
      {showTeam && <TeamModal workspace={workspace} onClose={() => setShowTeam(false)} />}
      {showAbonnement && <AbonnementModal workspace={workspace} subscription={subscription} onClose={() => setShowAbonnement(false)} />}
      {showCampagne && <CampagneModalSaas clients={clients} workspace={workspace} onClose={() => setShowCampagne(false)} />}
      {showLivreurs && <EquipeModal titre="Livreurs" items={livreurs} onAdd={addLivreur} onDelete={deleteLivreur} onClose={() => setShowLivreurs(false)} avecEmail />}
      {showClosers && <EquipeModal titre="Closers" items={closers} onAdd={addCloser} onDelete={deleteCloser} onClose={() => setShowClosers(false)} avecEmail />}
      {showProduits && <ProduitsModal produits={produits} onAdd={addProduit} onUpdateCout={updateProduitCout} onUpdateStock={updateProduitStock} quantitesParProduit={quantitesParProduit} onDelete={deleteProduit} currency={workspace.currency} onClose={() => setShowProduits(false)} />}
    </div>
  );
}

function AddCommandeModal({ onClose, onAdd, currency }) {
  const [form, setForm] = useState({ client: "", tel: "", produit: "", montant: "", zone: "" });
  const montantValide = Number(form.montant) > 0;
  const canSubmit = form.client.trim() && montantValide;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 360 }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 14 }}>Nouvelle commande</div>
        {["client", "tel", "produit", "montant", "zone"].map((f) => (
          <input
            key={f}
            placeholder={f === "montant" ? `Montant (${currency})` : f}
            value={form[f]}
            onChange={(e) => setForm({ ...form, [f]: e.target.value })}
            type={f === "montant" ? "number" : "text"}
            min={f === "montant" ? "1" : undefined}
            style={inputStyle}
          />
        ))}
        {form.montant && !montantValide && (
          <div style={{ color: "#D64933", fontSize: 12, marginTop: -6, marginBottom: 10 }}>Le montant doit être supérieur à 0.</div>
        )}
        <button onClick={() => canSubmit && onAdd(form)} disabled={!canSubmit} style={btnStyle}>
          Ajouter
        </button>
      </div>
    </div>
  );
}

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, marginBottom: 10, boxSizing: "border-box" };
const btnStyle = { width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "#1a7a3c", color: "white", fontWeight: 700, fontSize: 14, cursor: "pointer" };

function TeamModal({ workspace, onClose }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [retraitEnCours, setRetraitEnCours] = useState(null);

  async function loadMembers() {
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch(`/api/list-members?workspaceId=${workspace.id}`, {
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    });
    const json = await res.json();
    if (!res.ok) setError(json.error || "Erreur");
    else setMembers(json.members);
  }

  useEffect(() => {
    loadMembers();
  }, []);

  async function retirerMembre(memberUserId, email) {
    if (!window.confirm(`Retirer ${email} de l'équipe ? Cette personne perdra immédiatement l'accès.`)) return;
    setRetraitEnCours(memberUserId);
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/remove-member", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token}` },
      body: JSON.stringify({ workspaceId: workspace.id, memberUserId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) alert(json.error || "Erreur lors du retrait");
    else await loadMembers();
    setRetraitEnCours(null);
  }

  const roleLabels = { owner: "Propriétaire", admin: "Admin", closer: "Closer", livreur: "Livreur", comptable: "Comptable" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 400, maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Équipe</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        <button onClick={() => setShowInvite(true)} style={{ ...btnStyle, marginBottom: 14 }}>
          + Inviter quelqu'un
        </button>

        {error && <div style={{ color: "#D64933", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        {members === null && !error && <div style={{ color: "#8A9089", fontSize: 13 }}>Chargement...</div>}

        {members && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {members.map((m) => (
              <div key={m.id} style={{ background: "#FAFAF7", border: "1px solid #ECE8DC", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.email}</div>
                  <div style={{ fontSize: 11.5, color: "#6B7168" }}>{roleLabels[m.role] || m.role}</div>
                </div>
                {m.role !== "owner" && (
                  <button
                    onClick={() => retirerMembre(m.user_id, m.email)}
                    disabled={retraitEnCours === m.user_id}
                    style={{ background: "none", border: "none", color: "#D64933", cursor: "pointer", fontSize: 12.5, flexShrink: 0 }}
                  >
                    {retraitEnCours === m.user_id ? "..." : "🗑️ Retirer"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {showInvite && (
          <InviteMemberForm
            workspace={workspace}
            onClose={() => setShowInvite(false)}
            onInvited={() => {
              setShowInvite(false);
              loadMembers();
            }}
          />
        )}
      </div>
    </div>
  );
}

function InviteMemberForm({ workspace, onClose, onInvited }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("closer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const roles = [
    { key: "admin", label: "Admin — gestion opérationnelle" },
    { key: "closer", label: "Closer — ses commandes" },
    { key: "livreur", label: "Livreur — ses livraisons" },
    { key: "comptable", label: "Comptable — lecture financière" },
  ];

  async function submit() {
    if (!email || !password) {
      setError("Remplis email et mot de passe.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/invite-member", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token}` },
        body: JSON.stringify({ workspaceId: workspace.id, email, password, role }),
      });
      const json = await res.json().catch(() => ({ error: `Réponse invalide du serveur (code ${res.status})` }));
      if (!res.ok) setError(json.error || `Erreur (${res.status})`);
      else {
        if (json.compteExistant) {
          alert(`✅ ${email} avait déjà un compte — il/elle a été ajouté(e) à ton équipe avec son mot de passe habituel (le mot de passe que tu as tapé n'a pas été utilisé).`);
        }
        onInvited();
      }
    } catch (e) {
      setError("Erreur réseau: " + e.message);
    }
    setLoading(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 10 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 340 }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Inviter quelqu'un</div>
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        <input placeholder="Mot de passe temporaire" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        <div style={{ fontSize: 12, color: "#6B7168", marginBottom: 6 }}>Rôle</div>
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inputStyle, background: "white" }}>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
        {error && <div style={{ color: "#D64933", fontSize: 12.5, marginBottom: 10 }}>{error}</div>}
        <button onClick={submit} disabled={loading} style={btnStyle}>
          {loading ? "Création..." : "Créer le compte"}
        </button>
      </div>
    </div>
  );
}

function SubscriptionBanner({ subscription }) {
  if (subscription === undefined) return null;

  if (subscription === null) {
    return (
      <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "#8A6412" }}>
        ⚠️ Aucun abonnement associé à cet espace (créé avant la mise en place du système d'essai).
      </div>
    );
  }

  const planNom = subscription.subscription_plans?.nom || "?";

  if (subscription.status === "trial") {
    const finEssai = new Date(subscription.trial_ends_at);
    const joursRestants = Math.max(0, Math.floor((finEssai - new Date()) / 86400000));
    const expire = joursRestants === 0;
    return (
      <div style={{ background: expire ? "#FBEAE6" : "#EAF3DE", border: `1px solid ${expire ? "#F0B8AC" : "#C7DDA3"}`, borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: expire ? "#D64933" : "#3B6D11", fontWeight: 600 }}>
        {expire
          ? `⏰ Ton essai gratuit (${planNom}) est terminé.`
          : `🎁 Essai gratuit — plan ${planNom} — ${joursRestants} jour${joursRestants > 1 ? "s" : ""} restant${joursRestants > 1 ? "s" : ""}.`}
      </div>
    );
  }

  if (subscription.status === "active") {
    return (
      <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "#3B6D11", fontWeight: 600 }}>
        ✅ Abonnement actif — plan {planNom}
      </div>
    );
  }

  if (subscription.status === "suspended") {
    return (
      <div style={{ background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "#D64933", fontWeight: 600 }}>
        🔴 Abonnement suspendu — contacte le support pour réactiver.
      </div>
    );
  }

  return null;
}

function AdminPanel({ session }) {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState("");

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/admin-workspaces", {
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Erreur");
      setDebug(json.debug || "");
    } else setData(json);
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <Centered>
        <div style={{ textAlign: "center", maxWidth: 400, padding: 20 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
          <div style={{ color: "#D64933", fontWeight: 600 }}>{error}</div>
          {debug && <div style={{ color: "#8A9089", fontSize: 12, marginTop: 12, wordBreak: "break-all" }}>{debug}</div>}
        </div>
      </Centered>
    );
  }

  if (data === undefined) return <Centered>Chargement...</Centered>;

  const statusLabels = { trial: "🎁 Essai", active: "✅ Actif", suspended: "🔴 Suspendu", cancelled: "Annulé" };

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF7", fontFamily: "'IBM Plex Sans', sans-serif", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22 }}>Admin RecuVente</div>
        <a href="?" style={{ fontSize: 12.5, color: "#1a7a3c", textDecoration: "underline" }}>← Mon espace</a>
      </div>
      <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 20 }}>Connecté en tant que {session.user.email}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
        <div style={{ background: "#16231F", color: "white", borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, opacity: 0.7, textTransform: "uppercase" }}>MRR estimé</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: "#e8920a" }}>{data.mrr.toLocaleString("fr-FR")} XOF</div>
        </div>
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase" }}>Entreprises</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{data.total}</div>
        </div>
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase" }}>En essai / Actifs</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{data.enEssai} / {data.actifs}</div>
        </div>
      </div>

      {data.demandes && data.demandes.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, color: "#8A6412" }}>💰 Demandes de paiement en attente ({data.demandes.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.demandes.map((d) => (
              <DemandeCard key={d.id} demande={d} onConfirmed={load} />
            ))}
          </div>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Toutes les entreprises</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.workspaces.map((ws) => (
          <div key={ws.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{ws.name}</div>
              <div style={{ fontSize: 11.5, color: "#6B7168" }}>{ws.ownerEmail} · {ws.nbMembres} membre{ws.nbMembres > 1 ? "s" : ""} · {ws.country}</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {ws.subscription ? statusLabels[ws.subscription.status] || ws.subscription.status : "—"}
            </div>
          </div>
        ))}
        {data.workspaces.length === 0 && <div style={{ color: "#8A9089", fontSize: 13 }}>Aucune entreprise inscrite pour l'instant.</div>}
      </div>
    </div>
  );
}

function AbonnementModal({ workspace, subscription, onClose }) {
  const [plans, setPlans] = useState([]);
  const [demandes, setDemandes] = useState([]);
  const [loading, setLoading] = useState(null);
  const [message, setMessage] = useState("");

  async function load() {
    const { data: p } = await supabase.from("subscription_plans").select("*").order("prix");
    setPlans(p || []);
    const { data: d } = await supabase
      .from("upgrade_requests")
      .select("*, subscription_plans(nom)")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false });
    setDemandes(d || []);
  }

  useEffect(() => {
    load();
  }, []);

  const demandeEnAttente = demandes.find((d) => d.statut === "en_attente");

  async function demander(planId) {
    setLoading(planId);
    const { error } = await supabase.from("upgrade_requests").insert([
      { workspace_id: workspace.id, plan_id: planId },
    ]);
    if (error) {
      setMessage("Erreur: " + error.message);
    } else {
      setMessage("✅ Demande envoyée ! Effectue le paiement Mobile Money et contacte le support pour confirmation.");
      await load();
    }
    setLoading(null);
  }

  const planActuel = subscription?.subscription_plans?.nom;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 400, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Mon abonnement</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        {planActuel && (
          <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 13, color: "#3B6D11" }}>
            Plan actuel : <strong>{planActuel}</strong> — statut : {subscription.status}
          </div>
        )}

        {demandeEnAttente && (
          <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 13, color: "#8A6412" }}>
            ⏳ Demande en attente pour le plan <strong>{demandeEnAttente.subscription_plans?.nom}</strong> — en attente de confirmation.
          </div>
        )}

        {message && (
          <div style={{ background: "#EAF3DE", borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 12.5, color: "#3B6D11" }}>
            {message}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {plans.map((p) => (
            <div key={p.id} style={{ border: "1px solid #ECE8DC", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{p.nom}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, color: "#1a7a3c", marginTop: 3 }}>
                {Number(p.prix).toLocaleString("fr-FR")} {p.devise}<span style={{ fontSize: 11, color: "#8A9089", fontWeight: 400 }}>/mois</span>
              </div>
              <div style={{ fontSize: 11.5, color: "#6B7168", marginTop: 4 }}>
                {p.max_commandes_mois ? `${p.max_commandes_mois} commandes/mois` : "Commandes illimitées"} · {p.max_membres ? `${p.max_membres} membres max` : "Membres illimités"}
              </div>
              <button
                onClick={() => demander(p.id)}
                disabled={loading === p.id || !!demandeEnAttente}
                style={{ width: "100%", marginTop: 10, padding: "9px 0", borderRadius: 8, border: "none", background: p.nom === planActuel ? "#DDD8CC" : "#1a7a3c", color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
              >
                {loading === p.id ? "..." : p.nom === planActuel ? "Plan actuel" : "Demander ce plan"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemandeCard({ demande, onConfirmed }) {
  const [loading, setLoading] = useState(false);

  async function confirmer() {
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/confirmer-paiement", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token}` },
      body: JSON.stringify({ requestId: demande.id }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) await onConfirmed();
    else alert("Erreur (" + res.status + "): " + (json.error || "inconnue"));
    setLoading(false);
  }

  return (
    <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{demande.workspaceName}</div>
        <div style={{ fontSize: 12, color: "#8A6412" }}>
          Demande plan <strong>{demande.subscription_plans?.nom}</strong> — {Number(demande.subscription_plans?.prix).toLocaleString("fr-FR")} {demande.subscription_plans?.devise}
        </div>
      </div>
      <button onClick={confirmer} disabled={loading} style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
        {loading ? "..." : "✅ Confirmer reçu"}
      </button>
    </div>
  );
}

const STATUTS = {
  en_cours: { label: "En cours", color: "#E8A93D", bg: "#FBF3E3" },
  confirmee: { label: "Confirmée", color: "#1F9D6E", bg: "#EAF7F1" },
  echouee: { label: "Échouée", color: "#D64933", bg: "#FBEAE6" },
};

function CommandeCard({ commande, currency, onStatusChanged, livreurs = [], closers = [], onAssignLivreur, onAssignCloser, workspace, confirmateurNom }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ client: commande.client, tel: commande.tel, produit: commande.produit, montant: commande.montant, zone: commande.zone });
  const s = STATUTS[commande.statut] || STATUTS.en_cours;

  async function enregistrerInfos() {
    setLoading(true);
    const infos = { client: form.client, tel: form.tel, produit: form.produit, montant: Number(form.montant), zone: form.zone };
    const { error } = await supabase.from("commandes").update(infos).eq("id", commande.id);
    if (error) {
      alert("Erreur: " + error.message);
    } else {
      await supabase.from("relances").insert([{ commande_id: commande.id, note: "✏️ Informations modifiées" }]);
      await onStatusChanged();
      setEditing(false);
    }
    setLoading(false);
  }

  async function changerStatut(nouveauStatut) {
    setLoading(true);
    const ancienStatut = commande.statut;
    const infosValidation = nouveauStatut === "confirmee" ? { confirmed_at: new Date().toISOString(), confirmed_by: confirmateurNom || "Admin" } : {};
    const { error } = await supabase.from("commandes").update({ statut: nouveauStatut, ...infosValidation }).eq("id", commande.id);
    if (error) {
      alert("Erreur: " + error.message);
    } else {
      await supabase.from("relances").insert([
        { commande_id: commande.id, note: `📋 Statut : ${STATUTS[ancienStatut]?.label || ancienStatut} → ${STATUTS[nouveauStatut]?.label || nouveauStatut}${nouveauStatut === "confirmee" ? ` par ${confirmateurNom || "Admin"}` : ""}` },
      ]);
      await onStatusChanged();
    }
    setLoading(false);
    setOpen(false);
  }

  return (
    <div style={{ background: "white", border: "1px solid #ECE8DC", borderLeft: `4px solid ${s.color}`, borderRadius: 10, padding: "12px 14px" }}>
      {editing ? (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Modifier la commande</div>
          {["client", "tel", "produit", "montant", "zone"].map((f) => (
            <input
              key={f}
              placeholder={f === "montant" ? `Montant (${currency})` : f}
              value={form[f]}
              onChange={(e) => setForm({ ...form, [f]: e.target.value })}
              type={f === "montant" ? "number" : "text"}
              style={{ ...inputStyle, marginBottom: 6, padding: "7px 9px", fontSize: 13 }}
            />
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button onClick={enregistrerInfos} disabled={loading} style={{ flex: 1, background: "#1a7a3c", color: "white", border: "none", borderRadius: 7, padding: "8px 0", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
              {loading ? "..." : "Enregistrer"}
            </button>
            <button onClick={() => setEditing(false)} style={{ flex: 1, background: "white", border: "1px solid #DDD8CC", color: "#16231F", borderRadius: 7, padding: "8px 0", fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
      <>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{commande.client}</div>
          <div style={{ fontSize: 12, color: "#6B7168" }}>{commande.produit} · {commande.zone}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: s.color, background: s.bg, padding: "2px 8px", borderRadius: 999, display: "inline-block" }}>
              {s.label}
            </span>
            {commande.livreur && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "#1a7a3c", background: "#EAF3DE", padding: "2px 8px", borderRadius: 999 }}>🚚 {commande.livreur}</span>
            )}
            {commande.closer && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8A6412", background: "#FBF3E3", padding: "2px 8px", borderRadius: 999 }}>🎧 {commande.closer}</span>
            )}
            {commande.statut === "confirmee" && commande.confirmed_by && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "#1a7a3c", background: "#EAF3DE", padding: "2px 8px", borderRadius: 999 }}>✅ validé par {commande.confirmed_by}</span>
            )}
          </div>
        </div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{Number(commande.montant).toLocaleString("fr-FR")} {currency}</div>
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F0EEE6" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {Object.entries(STATUTS).map(([key, val]) => (
              <button
                key={key}
                onClick={() => changerStatut(key)}
                disabled={loading || commande.statut === key}
                style={{
                  flex: 1,
                  padding: "7px 4px",
                  borderRadius: 7,
                  border: `1px solid ${commande.statut === key ? val.color : "#DDD8CC"}`,
                  background: commande.statut === key ? val.bg : "white",
                  color: commande.statut === key ? val.color : "#6B7168",
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: commande.statut === key ? "default" : "pointer",
                }}
              >
                {val.label}
              </button>
            ))}
          </div>

          {(livreurs.length > 0 || closers.length > 0) && (
            <div style={{ display: "flex", gap: 8 }}>
              {livreurs.length > 0 && (
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10.5, color: "#8A9089", display: "block", marginBottom: 3 }}>Livreur</label>
                  <select
                    value={commande.livreur || ""}
                    onChange={(e) => onAssignLivreur(commande.id, e.target.value)}
                    style={{ width: "100%", padding: "7px 8px", borderRadius: 7, border: "1px solid #DDD8CC", fontSize: 12, background: "white" }}
                  >
                    <option value="">Non assigné</option>
                    {livreurs.map((l) => (
                      <option key={l.id} value={l.nom}>{l.nom}</option>
                    ))}
                  </select>
                </div>
              )}
              {closers.length > 0 && (
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10.5, color: "#8A9089", display: "block", marginBottom: 3 }}>Closer</label>
                  <select
                    value={commande.closer || ""}
                    onChange={(e) => onAssignCloser(commande.id, e.target.value)}
                    style={{ width: "100%", padding: "7px 8px", borderRadius: 7, border: "1px solid #DDD8CC", fontSize: 12, background: "white" }}
                  >
                    <option value="">Non assigné</option>
                    {closers.map((c) => (
                      <option key={c.id} value={c.nom}>{c.nom}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {workspace && (
            <>
              {commande.statut !== "confirmee" ? (
                <a
                  href={`https://wa.me/${cleanPhoneForWhatsApp(commande.tel)}?text=${encodeURIComponent(`Bonjour ${(commande.client || "").split(" ")[0]} 👋, suivez votre commande en direct ici : ${window.location.origin}/?suivi=${commande.id}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "block", textAlign: "center", width: "100%", background: "white", border: "1px solid #DDD8CC", color: "#16231F", padding: "9px 0", borderRadius: 8, fontWeight: 600, fontSize: 12.5, cursor: "pointer", marginBottom: 8, textDecoration: "none", boxSizing: "border-box" }}
                >
                  🔗 Envoyer le lien de suivi
                </a>
              ) : (
                <a
                  href={`https://wa.me/${cleanPhoneForWhatsApp(commande.tel)}?text=${encodeURIComponent(`Bonjour ${(commande.client || "").split(" ")[0]} 🙏, merci d'avoir commandé chez ${workspace.name} !\n\n🧾 Reçu de votre commande\nProduit : ${commande.produit}\nMontant : ${Number(commande.montant).toLocaleString("fr-FR")} ${workspace.currency}\nDate : ${new Date(commande.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}\n\nVotre colis vous a été livré avec succès ✅\n\nMerci pour votre confiance, à très bientôt ! 💚`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "block", textAlign: "center", width: "100%", background: "linear-gradient(135deg, #e8920a, #f0b94a)", color: "white", padding: "10px 0", borderRadius: 8, fontWeight: 700, fontSize: 12.5, cursor: "pointer", marginBottom: 8, textDecoration: "none", boxSizing: "border-box" }}
                >
                  🙏 Message de remerciement + reçu
                </a>
              )}
              <button
                onClick={() => genererFacturePDF(commande, workspace)}
                style={{ width: "100%", background: "white", border: "1px solid #DDD8CC", color: "#16231F", padding: "9px 0", borderRadius: 8, fontWeight: 600, fontSize: 12.5, cursor: "pointer", marginBottom: 10 }}
              >
                🧾 Facture PDF
              </button>
            </>
          )}

          <button
            onClick={() => setEditing(true)}
            style={{ width: "100%", background: "white", border: "1px solid #DDD8CC", color: "#16231F", padding: "9px 0", borderRadius: 8, fontWeight: 600, fontSize: 12.5, cursor: "pointer", marginBottom: 10 }}
          >
            ✏️ Modifier les informations
          </button>

          <HistoriqueRelances commandeId={commande.id} />
        </div>
      )}
      </>
      )}
    </div>
  );
}

function HistoriqueRelances({ commandeId }) {
  const [relances, setRelances] = useState(null);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    const { data } = await supabase.from("relances").select("*").eq("commande_id", commandeId).order("created_at", { ascending: false });
    setRelances(data || []);
  }

  useEffect(() => {
    load();
  }, [commandeId]);

  async function ajouter() {
    if (!note.trim()) return;
    setAdding(true);
    await supabase.from("relances").insert([{ commande_id: commandeId, note: note.trim() }]);
    setNote("");
    await load();
    setAdding(false);
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F0EEE6" }}>
      <div style={{ fontSize: 10.5, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 8 }}>
        Historique {relances && relances.length > 0 && `(${relances.length})`}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ajouter()}
          placeholder="Ex: Appelé, pas de réponse"
          style={{ flex: 1, padding: "7px 9px", borderRadius: 7, border: "1px solid #DDD8CC", fontSize: 12 }}
        />
        <button onClick={ajouter} disabled={adding || !note.trim()} style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 7, padding: "0 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          +
        </button>
      </div>
      {relances && relances.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 160, overflowY: "auto" }}>
          {relances.map((r) => (
            <div key={r.id} style={{ background: "#FAFAF7", borderRadius: 7, padding: "6px 9px" }}>
              <div style={{ fontSize: 12 }}>{r.note}</div>
              <div style={{ fontSize: 10, color: "#8A9089", marginTop: 1 }}>
                {new Date(r.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EquipeModal({ titre, items, onAdd, onDelete, onClose, avecEmail }) {
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [email, setEmail] = useState("");

  async function ajouter() {
    if (!nom.trim()) return;
    const payload = { nom: nom.trim(), telephone: telephone.trim() };
    if (avecEmail) payload.email = email.trim();
    await onAdd(payload);
    setNom("");
    setTelephone("");
    setEmail("");
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 360, maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{titre}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: avecEmail ? 6 : 16 }}>
          <input placeholder="Nom" value={nom} onChange={(e) => setNom(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
          <input placeholder="Téléphone" value={telephone} onChange={(e) => setTelephone(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
        </div>
        {avecEmail && (
          <div style={{ marginBottom: 16 }}>
            <input placeholder="Email de connexion (optionnel, pour le suivi GPS)" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inputStyle, marginBottom: 4 }} />
            <div style={{ fontSize: 11, color: "#8A9089" }}>Invite-le d'abord via "Gérer l'équipe", avec ce même email et le rôle Livreur.</div>
          </div>
        )}
        <button onClick={ajouter} style={{ width: "100%", background: "#1a7a3c", color: "white", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 16 }}>
          Ajouter
        </button>

        {items.length === 0 && <div style={{ color: "#8A9089", fontSize: 13 }}>Aucun {titre.toLowerCase()} pour l'instant.</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it) => (
            <div key={it.id} style={{ background: "#FAFAF7", border: "1px solid #ECE8DC", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{it.nom}</div>
                {it.telephone && <div style={{ fontSize: 11.5, color: "#6B7168" }}>{it.telephone}</div>}
                {it.email && <div style={{ fontSize: 10.5, color: "#8A9089" }}>{it.email}</div>}
              </div>
              <button onClick={() => onDelete(it.id, it.nom)} style={{ background: "none", border: "none", color: "#D64933", cursor: "pointer", fontSize: 13 }}>🗑️</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


function ProduitsModal({ produits, onAdd, onUpdateCout, onUpdateStock, quantitesParProduit, onDelete, currency, onClose }) {
  const [nom, setNom] = useState("");
  const [cout, setCout] = useState("");
  const [editId, setEditId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editStockId, setEditStockId] = useState(null);
  const [editStockValue, setEditStockValue] = useState("");

  async function ajouter() {
    if (!nom.trim()) return;
    await onAdd({ nom: nom.trim(), cout_achat: cout });
    setNom("");
    setCout("");
  }

  const totalStock = produits.reduce((s, p) => s + Number(p.stock_initial || 0), 0);
  const totalVendu = produits.reduce((s, p) => s + (quantitesParProduit[p.nom]?.commandees || 0), 0);
  const totalLivre = produits.reduce((s, p) => s + (quantitesParProduit[p.nom]?.livrees || 0), 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 400, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Catalogue & Stock</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: "#6B7168", marginBottom: 14 }}>
          Le nom doit correspondre exactement à celui utilisé dans tes commandes. Renseigne le stock acheté pour suivre ce qu'il reste.
        </div>

        {produits.length > 0 && (
          <div style={{ background: "#16231F", borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", justifyContent: "space-around", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", textTransform: "uppercase" }}>En stock</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, color: "white" }}>{totalStock}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", textTransform: "uppercase" }}>Engagé</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, color: "#e8920a" }}>{totalVendu}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", textTransform: "uppercase" }}>Livré</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, color: "#7fd6a3" }}>{totalLivre}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", textTransform: "uppercase" }}>Restant</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, color: "white" }}>{totalStock - totalVendu}</div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <input placeholder="Nom du produit" value={nom} onChange={(e) => setNom(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 2 }} />
          <input placeholder="Coût" type="number" value={cout} onChange={(e) => setCout(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
          <button onClick={ajouter} style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 8, padding: "0 14px", fontWeight: 700, fontSize: 18, cursor: "pointer" }}>+</button>
        </div>

        {produits.length === 0 && <div style={{ color: "#8A9089", fontSize: 13 }}>Aucun produit dans le catalogue.</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {produits.map((p) => {
            const q = quantitesParProduit[p.nom] || { commandees: 0, livrees: 0 };
            const stock = Number(p.stock_initial || 0);
            const restant = stock - q.commandees;
            return (
              <div key={p.id} style={{ background: "#FAFAF7", border: "1px solid #ECE8DC", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nom}</div>
                    {editId === p.id ? (
                      <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                        <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus style={{ flex: 1, padding: "5px 7px", borderRadius: 6, border: "1px solid #DDD8CC", fontSize: 12 }} />
                        <button onClick={() => { onUpdateCout(p.id, editValue); setEditId(null); }} style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 6, padding: "0 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>OK</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditId(p.id); setEditValue(String(p.cout_achat)); }} style={{ background: "none", border: "none", padding: 0, marginTop: 2, fontSize: 12, color: "#6B7168", textDecoration: "underline", cursor: "pointer" }}>
                        Coût : {Number(p.cout_achat).toLocaleString("fr-FR")} {currency}
                      </button>
                    )}
                  </div>
                  <button onClick={() => onDelete(p.id)} style={{ background: "none", border: "none", color: "#D64933", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>🗑️</button>
                </div>

                <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #ECE8DC" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 10.5, color: "#8A9089", textTransform: "uppercase" }}>Stock acheté</span>
                    {editStockId === p.id ? (
                      <div style={{ display: "flex", gap: 5 }}>
                        <input type="number" value={editStockValue} onChange={(e) => setEditStockValue(e.target.value)} autoFocus style={{ width: 65, padding: "4px 6px", borderRadius: 6, border: "1px solid #DDD8CC", fontSize: 12 }} />
                        <button onClick={() => { onUpdateStock(p.id, editStockValue); setEditStockId(null); }} style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 6, padding: "0 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>OK</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditStockId(p.id); setEditStockValue(String(p.stock_initial || 0)); }} style={{ background: "none", border: "none", padding: 0, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 13, color: "#16231F", textDecoration: "underline", cursor: "pointer" }}>
                        {stock} pièces
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    <div style={{ flex: 1, background: "#FBF3E3", borderRadius: 7, padding: "5px 7px", textAlign: "center" }}>
                      <div style={{ fontSize: 9.5, color: "#8A6412" }}>Engagé</div>
                      <div style={{ fontWeight: 700, fontSize: 12.5, color: "#8A6412" }}>{q.commandees}</div>
                    </div>
                    <div style={{ flex: 1, background: "#EAF7F1", borderRadius: 7, padding: "5px 7px", textAlign: "center" }}>
                      <div style={{ fontSize: 9.5, color: "#1F9D6E" }}>Livré</div>
                      <div style={{ fontWeight: 700, fontSize: 12.5, color: "#1F9D6E" }}>{q.livrees}</div>
                    </div>
                    <div style={{ flex: 1, background: restant <= 5 && stock > 0 ? "#FBEAE6" : "#EAF3DE", borderRadius: 7, padding: "5px 7px", textAlign: "center" }}>
                      <div style={{ fontSize: 9.5, color: restant <= 5 && stock > 0 ? "#D64933" : "#3B6D11" }}>Restant</div>
                      <div style={{ fontWeight: 700, fontSize: 12.5, color: restant <= 5 && stock > 0 ? "#D64933" : "#3B6D11" }}>{stock > 0 ? restant : "—"}</div>
                    </div>
                  </div>
                  {stock > 0 && restant <= 5 && restant > 0 && (
                    <div style={{ fontSize: 10, color: "#D64933", marginTop: 4, fontWeight: 600 }}>⚠️ Stock bientôt épuisé</div>
                  )}
                  {stock > 0 && restant <= 0 && (
                    <div style={{ fontSize: 10, color: "#D64933", marginTop: 4, fontWeight: 600 }}>🔴 Stock épuisé</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LivreurPortalSaas({ livreur, commandes, currency, onStatusChanged }) {
  const [enTournee, setEnTournee] = useState(!!livreur.en_tournee);
  const [gpsErreur, setGpsErreur] = useState(null);
  const watchIdRef = React.useRef(null);

  async function majPosition(lat, lng) {
    await supabase.from("livreurs").update({ position_lat: lat, position_lng: lng, position_maj: new Date().toISOString() }).eq("id", livreur.id);
  }

  function demarrerTournee() {
    if (!navigator.geolocation) {
      setGpsErreur("La géolocalisation n'est pas disponible sur cet appareil.");
      return;
    }
    setGpsErreur(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await supabase.from("livreurs").update({ en_tournee: true }).eq("id", livreur.id);
        await majPosition(pos.coords.latitude, pos.coords.longitude);
        setEnTournee(true);
        watchIdRef.current = navigator.geolocation.watchPosition(
          (p) => majPosition(p.coords.latitude, p.coords.longitude),
          () => {},
          { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
        );
      },
      (err) => {
        setGpsErreur(err.code === err.PERMISSION_DENIED ? "Autorisation de localisation refusée. Active-la dans les réglages de ton téléphone." : "Impossible d'obtenir ta position pour le moment.");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function terminerTournee() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    await supabase.from("livreurs").update({ en_tournee: false }).eq("id", livreur.id);
    setEnTournee(false);
  }

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  const actives = commandes.filter((c) => c.statut === "en_cours" || c.statut === "echouee");
  const confirmees = commandes.filter((c) => c.statut === "confirmee");

  const bilanParJour = React.useMemo(() => {
    const map = {};
    confirmees.forEach((c) => {
      const d = new Date(c.created_at);
      const key = d.toISOString().slice(0, 10);
      if (!map[key]) {
        map[key] = { date: key, label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), livrees: 0, gains: 0 };
      }
      map[key].livrees += 1;
      map[key].gains += 1500;
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [confirmees]);
  const [showBilan, setShowBilan] = useState(false);

  async function changerStatut(commandeId, nouveauStatut) {
    const infosValidation = nouveauStatut === "confirmee" ? { confirmed_at: new Date().toISOString(), confirmed_by: livreur.nom } : {};
    await supabase.from("commandes").update({ statut: nouveauStatut, ...infosValidation }).eq("id", commandeId);
    await onStatusChanged();
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF7", fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div style={{ background: "#1a7a3c", color: "white", padding: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>RecuVente</div>
        <div style={{ fontSize: 13, opacity: 0.8 }}>Bonjour</div>
        <div style={{ fontWeight: 700, fontSize: 22 }}>{livreur.nom}</div>

        <button
          onClick={enTournee ? terminerTournee : demarrerTournee}
          style={{ width: "100%", marginTop: 14, padding: "13px 0", borderRadius: 10, border: "none", background: enTournee ? "#D64933" : "#e8920a", color: "white", fontWeight: 700, fontSize: 14.5, cursor: "pointer" }}
        >
          {enTournee ? "🔴 Terminer ma tournée" : "🟢 Démarrer ma tournée"}
        </button>
        {enTournee && <div style={{ fontSize: 11.5, opacity: 0.8, marginTop: 6, textAlign: "center" }}>📍 Ta position est partagée avec l'entreprise pendant ta tournée</div>}
        {gpsErreur && <div style={{ background: "rgba(214,73,51,0.2)", borderRadius: 8, padding: "8px 10px", marginTop: 8, fontSize: 12 }}>{gpsErreur}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, opacity: 0.75 }}>À traiter</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 20 }}>{actives.length}</div>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, opacity: 0.75 }}>Confirmées</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 20 }}>{confirmees.length}</div>
          </div>
        </div>

        <div style={{ marginTop: 10, background: "rgba(232,146,10,0.18)", border: "1px solid rgba(232,146,10,0.35)", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, opacity: 0.85 }}>💰 Mes gains ({confirmees.length} × 1 500 {currency})</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 22, color: "#e8920a", marginTop: 2 }}>
            {(confirmees.length * 1500).toLocaleString("fr-FR")} {currency}
          </div>
          {bilanParJour.length > 0 && (
            <button
              onClick={() => setShowBilan(!showBilan)}
              style={{ marginTop: 8, background: "rgba(255,255,255,0.15)", border: "none", color: "white", borderRadius: 7, padding: "6px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
            >
              📊 {showBilan ? "Cacher" : "Voir"} mon bilan journalier
            </button>
          )}
        </div>

        {showBilan && bilanParJour.length > 0 && (
          <div style={{ marginTop: 10, background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, opacity: 0.75, textTransform: "uppercase", marginBottom: 8 }}>Bilan par jour</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {bilanParJour.map((j) => (
                <div key={j.date} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5 }}>
                  <span style={{ textTransform: "capitalize", opacity: 0.9 }}>{j.label}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>
                    {j.livrees} livrée{j.livrees > 1 ? "s" : ""} · {j.gains.toLocaleString("fr-FR")} {currency}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", marginTop: 14, background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "8px 0", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          Déconnexion
        </button>
      </div>

      <div style={{ padding: "18px 20px" }}>
        {actives.length === 0 ? (
          <div style={{ textAlign: "center", padding: "50px 20px", color: "#8A9089" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
            <div style={{ fontSize: 14 }}>Aucune commande à traiter pour le moment.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {actives.map((c) => (
              <div key={c.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontWeight: 700, fontSize: 15.5 }}>{c.client}</div>
                <div style={{ fontSize: 13, color: "#6B7168", marginTop: 3 }}>{c.produit}</div>
                <div style={{ fontSize: 13, color: "#6B7168", marginTop: 2 }}>📍 {c.zone}</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 17, marginTop: 8, color: "#1a7a3c" }}>{Number(c.montant).toLocaleString("fr-FR")} {currency}</div>
                <a href={`tel:${c.tel}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "white", border: "1px solid #DDD8CC", color: "#16231F", padding: "10px 0", borderRadius: 9, fontWeight: 600, fontSize: 13, textDecoration: "none", marginTop: 12 }}>
                  📞 {c.tel}
                </a>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => changerStatut(c.id, "confirmee")} style={{ flex: 1, background: "#1F9D6E", color: "white", border: "none", padding: "11px 0", borderRadius: 9, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
                    ✅ Confirmer
                  </button>
                  <button onClick={() => changerStatut(c.id, "echouee")} style={{ flex: 1, background: "#D64933", color: "white", border: "none", padding: "11px 0", borderRadius: 9, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
                    ❌ Échoué
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ComptablePortalSaas({ workspace, beneficeReel, caConfirme, confirmees, coutLivraisons, coutProduitsInfo, COUT_LIVRAISON, depotsParLivreur, totalCommission, totalADeposer, livreurs }) {
  function parseProduitTexteLocal(texte) {
    if (!texte) return { nom: "", quantite: 1 };
    const match = texte.match(/^(.*?)\s*x\s*(\d+)\s*$/i);
    if (match) return { nom: match[1].trim(), quantite: Number(match[2]) || 1 };
    return { nom: texte.trim(), quantite: 1 };
  }

  const produitsParLivreur = {};
  depotsParLivreur.forEach((l) => {
    const mesConfirmees = confirmees.filter((c) => c.livreur === l.nom);
    const map = {};
    mesConfirmees.forEach((c) => {
      const { nom, quantite } = parseProduitTexteLocal(c.produit);
      if (!nom) return;
      if (!map[nom]) map[nom] = { nom, pieces: 0, ca: 0 };
      map[nom].pieces += quantite;
      map[nom].ca += Number(c.montant);
    });
    produitsParLivreur[l.nom] = Object.values(map).sort((a, b) => b.ca - a.ca);
  });

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF7", fontFamily: "'IBM Plex Sans', sans-serif", padding: 24 }}>
      <div style={{ background: "#16231F", color: "white", padding: 20, borderRadius: 14, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, opacity: 0.75 }}>🧮 Comptabilité — {workspace.name}</div>
          <button onClick={() => supabase.auth.signOut()} style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
            Déconnexion
          </button>
        </div>
      </div>

      <div style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 14, padding: "16px 18px", marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>💰 Bénéfice réel</div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 24, color: beneficeReel >= 0 ? "#7fd6a3" : "#f0a0a0", marginTop: 3 }}>
          {beneficeReel.toLocaleString("fr-FR")} {workspace.currency}
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
          CA confirmé {caConfirme.toLocaleString("fr-FR")} − Livraisons ({confirmees.length} × {COUT_LIVRAISON.toLocaleString("fr-FR")}) − Produits ({coutProduitsInfo.coutTotal.toLocaleString("fr-FR")})
        </div>
      </div>

      {coutProduitsInfo.nbInconnu > 0 && (
        <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#8A6412" }}>
          ⚠️ {coutProduitsInfo.nbInconnu} commande{coutProduitsInfo.nbInconnu > 1 ? "s" : ""} ({coutProduitsInfo.montantInconnu.toLocaleString("fr-FR")} {workspace.currency}) sans coût produit connu — bénéfice sous-estimé.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        <div style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>💵 À payer aux livreurs</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, color: "#e8920a", marginTop: 3 }}>{totalCommission.toLocaleString("fr-FR")} {workspace.currency}</div>
        </div>
        <div style={{ background: "linear-gradient(135deg, #1a7a3c, #1F9D6E)", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.75)", textTransform: "uppercase" }}>🏦 Dépôt attendu</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, color: "white", marginTop: 3 }}>{totalADeposer.toLocaleString("fr-FR")} {workspace.currency}</div>
        </div>
      </div>

      {livreurs.some((l) => l.en_tournee) && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>🟢 Livreurs en tournée</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {livreurs.filter((l) => l.en_tournee).map((l) => (
              <div key={l.id} style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{l.nom}</span>
                {l.position_lat && l.position_lng ? (
                  <a href={`https://www.google.com/maps?q=${l.position_lat},${l.position_lng}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#1a7a3c", fontWeight: 600 }}>📍 Voir</a>
                ) : (
                  <span style={{ fontSize: 11.5, color: "#8A9089" }}>Position en attente...</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Détail par livreur</div>
      {depotsParLivreur.length === 0 && <div style={{ color: "#8A9089", fontSize: 13 }}>Aucune livraison confirmée pour l'instant.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {depotsParLivreur.map((l) => (
          <LivreurDetailComptableSaas key={l.nom} l={l} produits={produitsParLivreur[l.nom] || []} currency={workspace.currency} />
        ))}
      </div>
    </div>
  );
}

function LivreurDetailComptableSaas({ l, produits, currency }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 10, padding: "12px 14px" }}>
      <div onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{l.nom}</div>
          <span style={{ fontSize: 11, color: "#1a7a3c", fontWeight: 600 }}>{open ? "Fermer ▲" : "Voir le détail ▼"}</span>
        </div>
        <div style={{ fontSize: 11.5, color: "#6B7168", marginTop: 2 }}>{l.livrees} livraison{l.livrees > 1 ? "s" : ""} · {l.montantRecupere.toLocaleString("fr-FR")} {currency} encaissé</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <div style={{ flex: 1, background: "#FBF3E3", borderRadius: 7, padding: "6px 9px", fontSize: 11, color: "#8A6412" }}>
          Commission : <strong>{l.commission.toLocaleString("fr-FR")}</strong>
        </div>
        <div style={{ flex: 1, background: "#EAF3DE", borderRadius: 7, padding: "6px 9px", fontSize: 11, color: "#3B6D11" }}>
          À déposer : <strong>{l.aDeposer.toLocaleString("fr-FR")}</strong>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F0EEE6" }}>
          <div style={{ fontSize: 10.5, color: "#8A9089", textTransform: "uppercase", marginBottom: 6 }}>CA par produit</div>
          {produits.length === 0 && <div style={{ fontSize: 12, color: "#8A9089" }}>Aucune vente confirmée.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {produits.map((p) => (
              <div key={p.nom} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: "#6B7168" }}>{p.nom} <span style={{ color: "#8A9089" }}>({p.pieces} pc)</span></span>
                <span style={{ fontWeight: 600 }}>{p.ca.toLocaleString("fr-FR")} {currency}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CloserPortalSaas({ closer, commandes, currency, workspace, onStatusChanged }) {
  const mesCommandes = commandes.filter((c) => c.closer === closer.nom);
  const actives = mesCommandes.filter((c) => c.statut === "en_cours" || c.statut === "echouee");
  const confirmees = mesCommandes.filter((c) => c.statut === "confirmee");
  const nonAssignees = commandes.filter((c) => !c.closer && (c.statut === "en_cours" || c.statut === "echouee"));
  const [selected, setSelected] = useState(null);

  async function changerStatut(commandeId, nouveauStatut) {
    const ancien = commandes.find((c) => c.id === commandeId)?.statut;
    const infosValidation = nouveauStatut === "confirmee" ? { confirmed_at: new Date().toISOString(), confirmed_by: closer.nom } : {};
    await supabase.from("commandes").update({ statut: nouveauStatut, ...infosValidation }).eq("id", commandeId);
    await supabase.from("relances").insert([
      { commande_id: commandeId, note: `📋 Statut : ${ancien} → ${nouveauStatut}${nouveauStatut === "confirmee" ? ` par ${closer.nom}` : ""}` },
    ]);
    await onStatusChanged();
    setSelected(null);
  }

  async function seAttribuer(commandeId) {
    const { data, error } = await supabase
      .from("commandes")
      .update({ closer: closer.nom })
      .eq("id", commandeId)
      .is("closer", null)
      .select();

    if (error) {
      alert("Erreur: " + error.message);
      return;
    }
    if (!data || data.length === 0) {
      alert("⚠️ Trop tard, un autre closer vient de la prendre");
      await onStatusChanged();
      return;
    }
    await supabase.from("relances").insert([{ commande_id: commandeId, note: `🎧 Prise en charge par ${closer.nom}` }]);
    await onStatusChanged();
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF7", fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <div style={{ background: "#1a7a3c", color: "white", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>RecuVente — {workspace.name}</div>
          <button onClick={() => supabase.auth.signOut()} style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
            Déconnexion
          </button>
        </div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 8 }}>Bonjour</div>
        <div style={{ fontWeight: 700, fontSize: 22 }}>{closer.nom}</div>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, opacity: 0.75 }}>À traiter</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 20 }}>{actives.length}</div>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, opacity: 0.75 }}>Confirmées</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 20 }}>{confirmees.length}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: "18px 20px" }}>
        {nonAssignees.length > 0 && (
          <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 14, padding: "14px 16px", marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: "#8A6412", marginBottom: 2 }}>
              🆓 Non assignées — à prendre ({nonAssignees.length})
            </div>
            <div style={{ fontSize: 12, color: "#8A6412", marginBottom: 10 }}>
              Personne n'a encore pris ces commandes. Une fois prise, elle disparaît pour les autres closers.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {nonAssignees.slice(0, 8).map((o) => (
                <div key={o.id} style={{ background: "white", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.client}</div>
                    <div style={{ fontSize: 11.5, color: "#6B7168" }}>{o.produit} · {Number(o.montant).toLocaleString("fr-FR")} {currency}</div>
                  </div>
                  <button
                    onClick={() => seAttribuer(o.id)}
                    style={{ flexShrink: 0, background: "#e8920a", color: "white", border: "none", borderRadius: 8, padding: "8px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                  >
                    Je la prends
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {actives.length === 0 ? (
          <div style={{ textAlign: "center", padding: "50px 20px", color: "#8A9089" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
            <div style={{ fontSize: 14 }}>Aucune commande à traiter pour le moment.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {actives.map((c) => (
              <div key={c.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "14px 16px" }}>
                <div onClick={() => setSelected(selected === c.id ? null : c.id)} style={{ cursor: "pointer" }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{c.client}</div>
                  <div style={{ fontSize: 13, color: "#6B7168", marginTop: 3 }}>{c.produit} · {c.tel}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 16, marginTop: 6, color: "#1a7a3c" }}>{Number(c.montant).toLocaleString("fr-FR")} {currency}</div>
                </div>

                {selected === c.id && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F0EEE6" }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <a href={`tel:${c.tel}`} style={{ flex: 1, textAlign: "center", background: "white", border: "1px solid #DDD8CC", color: "#16231F", padding: "9px 0", borderRadius: 8, fontWeight: 600, fontSize: 12.5, textDecoration: "none" }}>
                        📞 Appeler
                      </a>
                      <a
                        href={`https://wa.me/${cleanPhoneForWhatsApp(c.tel)}?text=${encodeURIComponent(`Bonjour ${(c.client || "").split(" ")[0]} 👋, nous confirmons votre commande "${c.produit}" (${Number(c.montant).toLocaleString("fr-FR")} ${currency}). Un livreur passera bientôt.`)}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ flex: 1, textAlign: "center", background: "#1F9D6E", color: "white", padding: "9px 0", borderRadius: 8, fontWeight: 600, fontSize: 12.5, textDecoration: "none" }}
                      >
                        💬 WhatsApp
                      </a>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => changerStatut(c.id, "confirmee")} style={{ flex: 1, background: "#1F9D6E", color: "white", border: "none", padding: "10px 0", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                        ✅ Confirmer
                      </button>
                      <button onClick={() => changerStatut(c.id, "echouee")} style={{ flex: 1, background: "#D64933", color: "white", border: "none", padding: "10px 0", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                        ❌ Échoué
                      </button>
                    </div>
                    <HistoriqueRelances commandeId={c.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDonutSaas({ livrees, enAttente, echouees }) {
  const total = livrees + enAttente + echouees || 1;
  const r = 34;
  const circ = 2 * Math.PI * r;
  const segs = [
    { val: livrees, color: "#1F9D6E" },
    { val: enAttente, color: "#E8A93D" },
    { val: echouees, color: "#D64933" },
  ];
  let offset = 0;
  return (
    <svg width="92" height="92" viewBox="0 0 92 92" style={{ flexShrink: 0 }}>
      <circle cx="46" cy="46" r={r} fill="none" stroke="#ECE8DC" strokeWidth="12" />
      {segs.map((s, i) => {
        const frac = s.val / total;
        const len = frac * circ;
        const el = (
          <circle key={i} cx="46" cy="46" r={r} fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} transform="rotate(-90 46 46)" />
        );
        offset += len;
        return el;
      })}
      <text x="46" y="50" textAnchor="middle" fontFamily="monospace" fontWeight="600" fontSize="18" fill="#16231F">
        {livrees + enAttente + echouees}
      </text>
    </svg>
  );
}

function EvolutionChartSaas({ data }) {
  const w = 300;
  const h = 110;
  const padL = 4, padR = 4, padT = 8, padB = 20;
  const maxVal = Math.max(...data.map((d) => d.commandes), 1);
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = padL + i * stepX;
    const y = padT + innerH - (d.commandes / maxVal) * innerH;
    return { x, y, d };
  });

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  const areaD = `${pathD} L ${points[points.length - 1].x} ${padT + innerH} L ${points[0].x} ${padT + innerH} Z`;

  return (
    <svg width="100%" height={h + 10} viewBox={`0 0 ${w} ${h + 10}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
      <path d={areaD} fill="#EAF3DE" />
      <path d={pathD} fill="none" stroke="#1a7a3c" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#1a7a3c" />)}
      {points.map((p, i) => {
        if (data.length > 8 && i % Math.ceil(data.length / 6) !== 0 && i !== data.length - 1) return null;
        return (
          <text key={"t" + i} x={p.x} y={h + 8} fontSize="8" fill="#8A9089" textAnchor="middle">
            {p.d.label}
          </text>
        );
      })}
    </svg>
  );
}

function CampagneModalSaas({ clients, workspace, onClose }) {
  const [segment, setSegment] = useState("tous");
  const [segmentProduit, setSegmentProduit] = useState("");
  const [message, setMessage] = useState("");
  const [productLink, setProductLink] = useState("");
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [sentCount, setSentCount] = useState(0);

  const produitsAchetes = useMemo(() => {
    const set = new Set();
    clients.forEach((c) => c.commandes.forEach((o) => set.add((o.produit || "").split(" x")[0].trim())));
    return Array.from(set).filter(Boolean);
  }, [clients]);

  const clientsSegmentes = useMemo(() => {
    const now = new Date();
    if (segment === "inactifs30") {
      return clients.filter((c) => {
        const dernier = c.commandes.reduce((max, o) => (new Date(o.created_at) > max ? new Date(o.created_at) : max), new Date(0));
        return (now - dernier) / (1000 * 3600 * 24) >= 30;
      });
    }
    if (segment === "produit" && segmentProduit) {
      return clients.filter((c) => c.commandes.some((o) => (o.produit || "").split(" x")[0].trim() === segmentProduit));
    }
    if (segment === "vip") {
      return clients.filter((c) => c.total >= 3);
    }
    return clients;
  }, [clients, segment, segmentProduit]);

  const current = clientsSegmentes[index];

  function personalize(tpl, nom) {
    let text = tpl.replace(/\{prenom\}/gi, (nom || "").split(" ")[0] || "");
    if (productLink.trim()) text = text.trim() + "\n\n" + productLink.trim();
    return text;
  }

  function send() {
    const text = personalize(message, current.nom);
    window.open(`https://wa.me/${cleanPhoneForWhatsApp(current.tel)}?text=${encodeURIComponent(text)}`, "_blank");
    setSentCount((c) => c + 1);
  }

  function next() {
    setIndex((i) => i + 1);
  }

  const finished = started && index >= clientsSegmentes.length;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxWidth: 400, maxHeight: "85vh", overflowY: "auto", borderRadius: 18, padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 18 }}>Campagne promo</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        {!started && (
          <>
            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 6 }}>À qui envoyer ?</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {[
                { key: "tous", label: `Tous les clients (${clients.length})` },
                { key: "vip", label: "Meilleurs clients — 3+ achats" },
                { key: "inactifs30", label: "Inactifs depuis 30+ jours" },
                { key: "produit", label: "Ayant acheté un produit précis" },
              ].map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSegment(s.key)}
                  style={{
                    textAlign: "left", padding: "9px 12px", borderRadius: 9,
                    border: "1px solid " + (segment === s.key ? "#1a7a3c" : "#DDD8CC"),
                    background: segment === s.key ? "#EAF3DE" : "white",
                    color: segment === s.key ? "#1a7a3c" : "#16231F",
                    fontSize: 13, fontWeight: segment === s.key ? 600 : 500, cursor: "pointer",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {segment === "produit" && (
              <select value={segmentProduit} onChange={(e) => setSegmentProduit(e.target.value)} style={{ width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid #DDD8CC", fontSize: 13, marginBottom: 14, background: "white" }}>
                <option value="">Choisir un produit...</option>
                {produitsAchetes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}

            <div style={{ background: "#EAF3DE", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: "#3B6D11", marginBottom: 14 }}>
              {clientsSegmentes.length} client{clientsSegmentes.length > 1 ? "s" : ""} concerné{clientsSegmentes.length > 1 ? "s" : ""}
            </div>

            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 6 }}>Message (utilise {"{prenom}"} pour personnaliser)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Bonjour {prenom} 👋, une offre spéciale vous attend chez ${workspace.name} !`}
              rows={4}
              style={{ width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid #DDD8CC", fontSize: 13, marginBottom: 10, boxSizing: "border-box", fontFamily: "inherit" }}
            />
            <input
              value={productLink}
              onChange={(e) => setProductLink(e.target.value)}
              placeholder="Lien à ajouter (optionnel)"
              style={{ width: "100%", padding: "9px 11px", borderRadius: 9, border: "1px solid #DDD8CC", fontSize: 13, marginBottom: 16, boxSizing: "border-box" }}
            />

            <button
              onClick={() => message.trim() && clientsSegmentes.length > 0 && setStarted(true)}
              disabled={!message.trim() || clientsSegmentes.length === 0}
              style={{ width: "100%", background: "#1a7a3c", color: "white", border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 700, fontSize: 14, cursor: "pointer", opacity: (!message.trim() || clientsSegmentes.length === 0) ? 0.5 : 1 }}
            >
              Démarrer l'envoi
            </button>
          </>
        )}

        {started && !finished && current && (
          <div>
            <div style={{ fontSize: 12, color: "#8A9089", marginBottom: 10 }}>{index + 1} / {clientsSegmentes.length}</div>
            <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{current.nom}</div>
              <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{current.tel}</div>
              <div style={{ marginTop: 10, fontSize: 13, whiteSpace: "pre-wrap", color: "#16231F" }}>{personalize(message, current.nom)}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { send(); next(); }} style={{ flex: 1, background: "#1F9D6E", color: "white", border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
                💬 Envoyer et suivant
              </button>
              <button onClick={next} style={{ background: "white", border: "1px solid #DDD8CC", color: "#16231F", borderRadius: 10, padding: "0 16px", fontSize: 13, cursor: "pointer" }}>
                Passer
              </button>
            </div>
          </div>
        )}

        {finished && (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🎉</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{sentCount} message{sentCount > 1 ? "s" : ""} envoyé{sentCount > 1 ? "s" : ""}</div>
            <button onClick={onClose} style={{ marginTop: 16, background: "#1a7a3c", color: "white", border: "none", borderRadius: 10, padding: "10px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Fermer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RepartitionLigne({ r }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 10, padding: "10px 12px" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: "100%", background: "none", border: "none", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", cursor: "pointer" }}
      >
        <span style={{ fontSize: 12.5 }}>
          <strong>{r.closer}</strong> → <strong>{r.livreur}</strong>
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1a7a3c" }}>{r.total} cmd {open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #F0EEE6", display: "flex", flexDirection: "column", gap: 5 }}>
          {r.produitsListe.map((p) => (
            <div key={p.nom} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
              <span style={{ color: "#6B7168" }}>{p.nom}</span>
              <span style={{ fontWeight: 600 }}>{p.qte} pièce{p.qte > 1 ? "s" : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
