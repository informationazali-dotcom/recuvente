import React, { useState, useEffect, useMemo, useRef } from "react";
import { Package, ListChecks, CheckCheck, Users, Truck, Headset, Calculator } from "lucide-react";
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
  const estRetailFacture = workspace.activity_type === "retail";
  const soldeRestant = Number(commande.montant) - Number(commande.montant_paye || 0);
  const paiementPartiel = estRetailFacture && commande.montant_paye && soldeRestant > 0 && commande.statut !== "confirmee";
  const statutPaiement = commande.statut === "confirmee" ? (estRetailFacture ? "PAYÉE" : "PAYÉE (à la livraison)") : paiementPartiel ? "ACOMPTE VERSÉ" : "EN ATTENTE DE PAIEMENT";
  const couleurStatut = commande.statut === "confirmee" ? green : orange;
  doc.setFillColor(...couleurStatut);
  doc.roundedRect(15, y, 75, 9, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(statutPaiement, 52.5, y + 6, { align: "center" });

  if (paiementPartiel) {
    doc.setTextColor(...dark);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Déjà payé : ${Number(commande.montant_paye).toLocaleString("fr-FR")} ${workspace.currency} — Solde restant : ${soldeRestant.toLocaleString("fr-FR")} ${workspace.currency}`, 15, y + 16);
    y += 8;
  }

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
      .select("workspace_id, role, workspaces(id, name, country, currency, created_at, webhook_secret, activity_type, whatsapp_number, logo_url, banniere_url, couleur_marque, description_boutique)")
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

  async function creerWorkspace(nom, activityType) {
    setLoadingWorkspace(true);
    const { data: ws, error } = await supabase
      .from("workspaces")
      .insert([{ owner_id: session.user.id, name: nom, activity_type: activityType || "cod_ecommerce" }])
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
    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "welcome", email: session.user.email, workspaceName: nom }),
    }).catch(() => {}); // silencieux si l'email échoue, ne bloque jamais l'inscription
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
  const [profil, setProfil] = useState("cod");

  useEffect(() => {
    supabase.from("subscription_plans").select("*").order("prix").then(({ data }) => setPlans(data || []));
  }, []);

  const contenuParProfil = {
    cod: {
      badge: "🏍️ Vente en ligne, paiement à la livraison",
      titre: "Arrête de perdre de l'argent sur des commandes que tu ne suis même plus",
      sousTitre: "Chaque commande oubliée dans WhatsApp, c'est de l'argent qui t'échappe. RecuVente suit tout, du premier appel jusqu'à l'argent réellement dans ta poche — sans que rien ne t'échappe.",
      captureLignes: [
        { label: "Argent récupéré", valeur: "1 240 500 FCFA", couleur: "#e8920a" },
        { label: "En cours", valeur: "18", couleur: "white" },
        { label: "Taux de livraison", valeur: "87%", couleur: "white" },
      ],
      avantages: [
        { icon: "📋", titre: "Chaque commande, du premier contact à la livraison", desc: "Statut en temps réel — en cours, confirmée, échouée — jamais un client qui se perd dans les échanges WhatsApp." },
        { icon: "🚚", titre: "Tes livreurs, suivis en direct", desc: "Position GPS pendant leur tournée, commission calculée automatiquement, montant exact à déposer chaque jour." },
        { icon: "🎧", titre: "Une équipe de closers, sans doublons", desc: "Chaque commande non assignée est prise par un seul closer à la fois — fini les deux personnes qui rappellent le même client." },
        { icon: "🧮", titre: "Le bénéfice réel, pas juste le chiffre d'affaires", desc: "Coût produit, commission livreur, tout déduit automatiquement — tu sais enfin ce qu'il te reste vraiment." },
        { icon: "📦", titre: "Le stock, avant la rupture", desc: "Alerte automatique par email quand un produit descend sous le seuil — plus jamais surpris." },
        { icon: "🔄", titre: "Le réachat, sans y penser", desc: "L'app détecte le rythme d'achat de chaque client et te dit qui relancer, et quand." },
      ],
    },
    retail: {
      badge: "🏪 Boutique / Commerce physique",
      titre: "Ta boutique mérite mieux qu'un cahier qu'on remplit à moitié",
      sousTitre: "Chaque vente non notée, chaque acompte oublié, c'est de l'argent que tu perds de vue. RecuVente organise ta boutique comme une vraie entreprise — sans cahier, sans Excel, sans rien oublier.",
      captureLignes: [
        { label: "Ventes du jour", valeur: "340 000 FCFA", couleur: "#e8920a" },
        { label: "Acomptes en attente", valeur: "5", couleur: "white" },
        { label: "Produits en stock", valeur: "142", couleur: "white" },
      ],
      avantages: [
        { icon: "🏪", titre: "Vente sur place ou livraison, en un clic", desc: "Choisis comment le produit sort du magasin — payé en entier sur place, ou remis à un livreur." },
        { icon: "💰", titre: "L'acompte, suivi jusqu'au dernier franc", desc: "Un client paie en plusieurs fois avant de retirer ? Le solde restant s'affiche clairement, jusqu'à ce qu'il soit réglé." },
        { icon: "📦", titre: "Le stock, produit par produit", desc: "Sais exactement ce qu'il te reste, ce qui est déjà vendu, ce qui va bientôt manquer." },
        { icon: "🧮", titre: "Le bénéfice réel de ta boutique", desc: "Coût produit déduit automatiquement, sans les frais de livraison inutiles pour une vente sur place." },
        { icon: "🧾", titre: "Une facture professionnelle, en un clic", desc: "PDF prêt à envoyer, avec le détail exact de l'acompte et du solde restant si besoin." },
        { icon: "📊", titre: "Toute ton équipe, un seul endroit", desc: "Vendeurs, comptable, chacun son rôle et son accès — plus de confusion sur qui a fait quoi." },
      ],
    },
  };

  const c = contenuParProfil[profil];

  const faq = [
    { q: "Comment fonctionne l'essai gratuit ?", r: "7 jours d'accès complet dès l'inscription, sur le plan Pro. Aucune carte bancaire requise. Tu peux annuler ou continuer à tout moment." },
    { q: "Comment se fait le paiement ?", r: "En ligne, directement dans l'app, activé automatiquement dès la confirmation du paiement." },
    { q: "Mes données sont-elles visibles par d'autres entreprises ?", r: "Non, jamais. Chaque entreprise a son espace complètement isolé et sécurisé — personne d'autre ne peut voir tes commandes, clients ou finances." },
    { q: "Puis-je changer de plan plus tard ?", r: "Oui, à tout moment, selon la croissance de ton activité." },
    { q: "RecuVente fonctionne pour quel type de commerce ?", r: "Deux profils au choix dès l'inscription : la vente en ligne avec paiement à la livraison (COD), ou la boutique physique avec vente sur place et acompte. Choisis celui qui te correspond." },
    { q: "Puis-je connecter ma boutique Shopify ?", r: "Oui — une intégration directe permet à tes commandes Shopify d'arriver automatiquement dans RecuVente, sans rien taper à la main." },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF7", fontFamily: "'IBM Plex Sans', sans-serif", color: "#16231F", overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,900&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        .rv-lp-toggle-btn { transition: all 0.25s ease; }
        .rv-lp-fade { animation: rvLpFadeIn 0.35s ease; }
        @keyframes rvLpFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .rv-lp-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(22,35,31,0.08); }
        .rv-lp-card { transition: all 0.2s ease; }
      `}</style>

      <div style={{ background: "linear-gradient(160deg, #16231F 0%, #1a7a3c 130%)", color: "white", padding: "48px 24px 0", position: "relative", overflow: "hidden" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center", position: "relative", zIndex: 1 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 20, marginBottom: 28, letterSpacing: "0.02em" }}>
            RECU<span style={{ color: "#e8920a" }}>VENTE</span>
          </div>

          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Quel est ton profil ?
          </div>
          <div style={{ display: "inline-flex", background: "rgba(255,255,255,0.1)", borderRadius: 999, padding: 4, marginBottom: 30 }}>
            <button
              className="rv-lp-toggle-btn"
              onClick={() => setProfil("cod")}
              style={{ padding: "10px 20px", borderRadius: 999, border: "none", background: profil === "cod" ? "white" : "transparent", color: profil === "cod" ? "#16231F" : "white", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              🏍️ Je vends en ligne
            </button>
            <button
              className="rv-lp-toggle-btn"
              onClick={() => setProfil("retail")}
              style={{ padding: "10px 20px", borderRadius: 999, border: "none", background: profil === "retail" ? "white" : "transparent", color: profil === "retail" ? "#16231F" : "white", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              🏪 J'ai une boutique
            </button>
          </div>

          <div key={profil} className="rv-lp-fade">
            <div style={{ display: "inline-block", fontSize: 11.5, fontWeight: 600, color: "#e8920a", background: "rgba(232,146,10,0.15)", padding: "5px 14px", borderRadius: 999, marginBottom: 18 }}>
              {c.badge}
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 32, lineHeight: 1.2, marginBottom: 14 }}>
              {c.titre}
            </div>
            <div style={{ fontSize: 15, opacity: 0.85, maxWidth: 460, margin: "0 auto 30px", lineHeight: 1.5 }}>
              {c.sousTitre}
            </div>
          </div>

          <a href="?auth=1" style={{ display: "inline-block", background: "#e8920a", color: "white", padding: "15px 36px", borderRadius: 12, fontWeight: 700, fontSize: 15, textDecoration: "none", boxShadow: "0 8px 20px rgba(232,146,10,0.35)" }}>
            Je démarre maintenant, gratuitement
          </a>
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 12 }}>7 jours d'accès complet · Sans carte bancaire · Actif en moins de 2 minutes</div>

          <div key={profil + "-preview"} className="rv-lp-fade" style={{ marginTop: 36, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "16px 16px 0 0", padding: "18px 20px 0", maxWidth: 480, margin: "36px auto 0" }}>
            <div style={{ display: "flex", gap: 10 }}>
              {c.captureLignes.map((l, i) => (
                <div key={i} style={{ flex: 1, background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 10px", textAlign: "left" }}>
                  <div style={{ fontSize: 9.5, opacity: 0.7, marginBottom: 4 }}>{l.label}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 14, color: l.couleur }}>{l.valeur}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "44px 24px 10px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, marginBottom: 10 }}>
          Chaque jour sans système, tu perds de l'argent — pas dans 6 mois, aujourd'hui
        </div>
        <div style={{ fontSize: 13.5, color: "#6B7168", marginBottom: 28, maxWidth: 480, margin: "0 auto 28px" }}>
          Une commande oubliée, un acompte non suivi, un livreur qu'on ne peut pas contrôler — ce n'est pas un détail. C'est de l'argent qui t'échappe, chaque jour, sans que tu le voies.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, textAlign: "left" }}>
          {[
            "Des commandes perdues quelque part dans WhatsApp",
            "Un cahier ou un Excel qu'on ne remplit plus à jour",
            "Impossible de savoir combien un livreur doit vraiment déposer",
            "Aucune idée du vrai bénéfice à la fin du mois",
          ].map((point, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, color: "#6B7168" }}>
              <span style={{ color: "#D64933", flexShrink: 0 }}>✕</span>
              {point}
            </div>
          ))}
        </div>
      </div>

      <div key={profil + "-avantages"} className="rv-lp-fade" style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 26 }}>
            Tout ce dont {profil === "cod" ? "ta vente en ligne" : "ta boutique"} a besoin
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
          {c.avantages.map((f, i) => (
            <div key={i} className="rv-lp-card" style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 14, padding: 22 }}>
              <div style={{ fontSize: 26, marginBottom: 10 }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{f.titre}</div>
              <div style={{ fontSize: 13, color: "#6B7168", lineHeight: 1.55 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "white", borderTop: "1px solid #ECE8DC", borderBottom: "1px solid #ECE8DC", padding: "36px 24px" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 20, textAlign: "center" }}>
          {[
            { icon: "🔒", txt: "Tes données, isolées et privées" },
            { icon: "⚡", txt: "Activation immédiate du paiement" },
            { icon: "📱", txt: "Fonctionne sur mobile comme sur ordinateur" },
          ].map((item, i) => (
            <div key={i}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{item.icon}</div>
              <div style={{ fontSize: 12.5, color: "#6B7168", fontWeight: 500 }}>{item.txt}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "10px 24px 40px" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22 }}>
            "Oui, mais..."
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { objection: "\"Je ne suis pas doué avec la technologie\"", reponse: "Si tu sais utiliser WhatsApp, tu sais utiliser RecuVente. Pensé pour être compris en quelques minutes, sans formation." },
            { objection: "\"Je n'ai pas le temps d'apprendre un nouvel outil\"", reponse: "C'est justement le temps que tu perds à chercher une commande dans WhatsApp que RecuVente te redonne." },
            { objection: "\"Ça doit être compliqué à mettre en place\"", reponse: "Créer ton espace prend moins de 2 minutes. Ta première commande peut être ajoutée tout de suite après." },
          ].map((item, i) => (
            <div key={i} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "16px 18px" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5, color: "#16231F" }}>{item.objection}</div>
              <div style={{ fontSize: 13, color: "#6B7168", lineHeight: 1.5 }}>{item.reponse}</div>
            </div>
          ))}
        </div>
      </div>

      {plans.length > 0 && (
        <div style={{ background: "#FAFAF7", padding: "50px 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 26 }}>Choisis ton plan, commence en 2 minutes</div>
            <div style={{ fontSize: 14, color: "#6B7168", marginTop: 8 }}>7 jours gratuits sur n'importe quel plan. Tu ne payes que si RecuVente te convainc.</div>
          </div>
          <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            {plans.map((p, i) => (
              <div key={p.id} className="rv-lp-card" style={{ border: i === 1 ? "2px solid #1a7a3c" : "1px solid #ECE8DC", borderRadius: 16, padding: 22, position: "relative", background: i === 1 ? "white" : "white" }}>
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

      <div style={{ background: "#16231F", color: "white", padding: "56px 24px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 26, marginBottom: 10 }}>
          {profil === "cod" ? "Ta prochaine commande mérite d'être suivie correctement" : "Ta boutique mérite mieux qu'un cahier"}
        </div>
        <div style={{ fontSize: 14, opacity: 0.75, marginBottom: 26, maxWidth: 400, margin: "0 auto 26px" }}>
          Chaque jour que tu attends, c'est une commande de plus qui risque de se perdre. Commence maintenant — c'est gratuit, et ça prend 2 minutes.
        </div>
        <a href="?auth=1" style={{ display: "inline-block", background: "#e8920a", color: "white", padding: "15px 36px", borderRadius: 12, fontWeight: 700, fontSize: 15, textDecoration: "none" }}>
          Créer mon espace gratuitement
        </a>
        <div style={{ fontSize: 11.5, opacity: 0.55, marginTop: 14 }}>Aucune carte bancaire · Annule à tout moment</div>
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
  const [activityType, setActivityType] = useState("cod_ecommerce");
  const [etape, setEtape] = useState(1);

  const types = [
    { key: "cod_ecommerce", icon: "📦", titre: "Vente en ligne (paiement à la livraison)", desc: "Commandes, livreurs, closers, suivi de livraison" },
    { key: "retail", icon: "🏪", titre: "Boutique / Commerce", desc: "Vente directe en magasin, avec suivi de stock" },
  ];

  return (
    <Centered>
      <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 16, padding: 30, width: 360 }}>
        {etape === 1 ? (
          <>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 20, marginBottom: 4 }}>Bienvenue 👋</div>
            <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 18 }}>
              Quel type d'activité gères-tu ?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
              {types.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActivityType(t.key)}
                  style={{
                    textAlign: "left", padding: "14px 16px", borderRadius: 12,
                    border: `2px solid ${activityType === t.key ? "#1a7a3c" : "#ECE8DC"}`,
                    background: activityType === t.key ? "#EAF3DE" : "white", cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{t.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: "#16231F" }}>{t.titre}</div>
                  <div style={{ fontSize: 11.5, color: "#6B7168", marginTop: 2 }}>{t.desc}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setEtape(2)} style={btnStyle}>
              Continuer
            </button>
          </>
        ) : (
          <>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 20, marginBottom: 4 }}>Presque fini</div>
            <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 20 }}>
              Nomme ton entreprise pour créer ton espace privé.
            </div>
            <input placeholder="Ex: Azali Express" value={nom} onChange={(e) => setNom(e.target.value)} style={inputStyle} autoFocus />
            <button onClick={() => nom.trim() && onCreate(nom.trim(), activityType)} disabled={loading || !nom.trim()} style={btnStyle}>
              {loading ? "Création..." : "Créer mon espace"}
            </button>
            <button
              onClick={() => setEtape(1)}
              style={{ width: "100%", marginTop: 10, padding: "10px 0", borderRadius: 10, border: "1px solid #DDD8CC", background: "white", color: "#6B7168", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              ← Retour
            </button>
          </>
        )}
        <button
          onClick={() => supabase.auth.signOut()}
          style={{ width: "100%", marginTop: 10, padding: "10px 0", borderRadius: 10, border: "none", background: "none", color: "#8A9089", fontWeight: 500, fontSize: 12, cursor: "pointer" }}
        >
          Déconnexion
        </button>
      </div>
    </Centered>
  );
}

function WorkspaceDashboard({ workspace, session, subscription }) {
  const [commandes, setCommandes] = useState([]);
  const [commandeItems, setCommandeItems] = useState([]);
  const [livreurs, setLivreurs] = useState([]);
  const [closers, setClosers] = useState([]);
  const [produits, setProduits] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [celebration, setCelebration] = useState(null);
  const [retourPaiement, setRetourPaiement] = useState(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("paiement") === "succes"
  );

  useEffect(() => {
    if (retourPaiement && typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [retourPaiement]);

  function playCelebrationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = "sine";
        o.frequency.value = freq;
        const start = ctx.currentTime + i * 0.09;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(0.16, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
        o.start(start);
        o.stop(start + 0.5);
      });
    } catch (e) {}
  }
  const [showTeam, setShowTeam] = useState(false);
  const [showAbonnement, setShowAbonnement] = useState(false);
  const [showLivreurs, setShowLivreurs] = useState(false);
  const [showClosers, setShowClosers] = useState(false);
  const [showCampagne, setShowCampagne] = useState(false);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [showProduits, setShowProduits] = useState(false);
  const [showAide, setShowAide] = useState(false);

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

  async function updateProduitPrixVente(id, prix) {
    await supabase.from("produits").update({ prix_vente: Number(prix) || 0 }).eq("id", id);
    await loadProduits();
  }

  async function updateProduitPhoto(id, url) {
    await supabase.from("produits").update({ photo_url: url || null }).eq("id", id);
    await loadProduits();
  }

  async function updateProduitDescription(id, description) {
    await supabase.from("produits").update({ description: description || null }).eq("id", id);
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
    if (subscription === undefined || subscription === null) return false;
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

  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  const VAPID_PUBLIC_KEY = "BNEWuL6J-c31X4sab428A92UjDE2GOirvhes0XlQz-bnNngVucHV22AdQzLq_FleLTsCNoFaxYkL_xDqR6WgHFs";

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function activerNotificationsPush() {
    try {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      if (permission !== "granted") return;

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        alert("Notifications Push non supportées sur ce navigateur");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (!sub) {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const raw = sub.toJSON();
      await supabase.from("push_subscriptions").upsert(
        [{ workspace_id: workspace.id, user_email: session.user.email, endpoint: raw.endpoint, p256dh: raw.keys.p256dh, auth: raw.keys.auth }],
        { onConflict: "endpoint" }
      );
      alert("🔔 Notifications activées, même app fermée !");
    } catch (e) {
      alert("Erreur activation notifications: " + e.message);
    }
  }

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
    const { data: items } = await supabase.from("commande_items").select("*").eq("workspace_id", workspace.id);
    setCommandeItems(items || []);
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
    const estRetail = workspace.activity_type === "retail";
    const headers = estRetail
      ? ["Client", "Téléphone", "Produit", "Montant", "Zone", "Statut", "Livreur", "Mode de vente", "Montant payé", "Solde restant", "Date"]
      : ["Client", "Téléphone", "Produit", "Montant", "Zone", "Statut", "Livreur", "Date"];
    const rows = commandesAffichees.map((c) => {
      const base = [c.client, c.tel, c.produit, c.montant, c.zone || "", STATUTS[c.statut]?.label || c.statut, c.livreur || ""];
      if (estRetail) {
        const paye = Number(c.montant_paye || 0);
        base.push(c.mode_vente === "expedition" ? "Expédition" : c.mode_vente === "livraison" ? "Livraison" : "Sur place", paye, Number(c.montant) - paye);
      }
      base.push(new Date(c.created_at).toLocaleDateString("fr-FR"));
      return base;
    });
    function neutraliser(valeur) {
      const s = String(valeur ?? "");
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
    const commandesAvecItems = new Set(commandeItems.map((it) => it.commande_id));
    commandes.forEach((c) => {
      if (commandesAvecItems.has(c.id)) return;
      const { nom, quantite } = parseProduitTexte(c.produit);
      if (!nom) return;
      if (!map[nom]) map[nom] = { commandees: 0, livrees: 0 };
      if (c.statut !== "echouee") map[nom].commandees += quantite;
      if (c.statut === "confirmee") map[nom].livrees += quantite;
    });
    const commandesById = Object.fromEntries(commandes.map((c) => [c.id, c]));
    commandeItems.forEach((it) => {
      const c = commandesById[it.commande_id];
      if (!c || !it.produit_nom) return;
      if (!map[it.produit_nom]) map[it.produit_nom] = { commandees: 0, livrees: 0 };
      if (c.statut !== "echouee") map[it.produit_nom].commandees += it.quantite;
      if (c.statut === "confirmee") map[it.produit_nom].livrees += it.quantite;
    });
    return map;
  }, [commandes, commandeItems]);

  const validationsParJour = useMemo(() => {
    const confirmeesAvecDate = commandes.filter((c) => c.statut === "confirmee" && c.confirmed_at);
    const map = {};
    confirmeesAvecDate.forEach((c) => {
      const dValidation = new Date(c.confirmed_at);
      const keyValidation = dValidation.toISOString().slice(0, 10);
      const dCreation = new Date(c.created_at);
      const keyCreation = dCreation.toISOString().slice(0, 10);
      const memeJour = keyValidation === keyCreation;
      if (!map[keyValidation]) {
        map[keyValidation] = { date: keyValidation, label: dValidation.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), orders: [] };
      }
      map[keyValidation].orders.push({ ...c, memeJour, labelCreation: dCreation.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) });
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [commandes]);

  const nonValideesParJour = useMemo(() => {
    const nonValidees = commandes.filter((c) => c.statut === "en_cours" || c.statut === "echouee");
    const map = {};
    nonValidees.forEach((c) => {
      const d = new Date(c.created_at);
      const key = d.toISOString().slice(0, 10);
      if (!map[key]) map[key] = { date: key, label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), orders: [] };
      map[key].orders.push(c);
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [commandes]);

  const produitsClassement = useMemo(() => {
    const map = {};
    commandesInRange.forEach((c) => {
      const nom = (c.produit || "Autre").split(" x")[0].trim();
      if (!map[nom]) map[nom] = { nom, ventes: 0, revenus: 0 };
      map[nom].ventes += 1;
      map[nom].revenus += Number(c.montant);
    });
    return Object.values(map).sort((a, b) => b.ventes - a.ventes);
  }, [commandesInRange]);

  const meilleurProduit = produitsClassement[0] || null;
  const produitPlusRentable = produitsClassement.length ? [...produitsClassement].sort((a, b) => b.revenus - a.revenus)[0] : null;

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

  const clientsSuspects = useMemo(() => {
    const map = {};
    commandes.forEach((c) => {
      const key = c.tel;
      if (!key) return;
      if (!map[key]) map[key] = { tel: key, nom: c.client, echouees: 0, total: 0 };
      map[key].total += 1;
      if (c.statut === "echouee") map[key].echouees += 1;
    });
    return Object.values(map).filter((c) => c.echouees >= 3);
  }, [commandes]);

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
    const montantTotal = Number(form.montant);
    const montantDejaPaye = workspace.activity_type === "retail" ? (form.montant_paye === "" ? montantTotal : Number(form.montant_paye)) : 0;
    const payeEnEntier = workspace.activity_type === "retail" ? montantDejaPaye >= montantTotal : false;
    const statutInitial = workspace.activity_type === "retail" ? (payeEnEntier ? "confirmee" : "en_cours") : "en_cours";
    const { error } = await supabase.from("commandes").insert([
      { ...form, montant: montantTotal, montant_paye: montantDejaPaye, workspace_id: workspace.id, statut: statutInitial, confirmed_at: statutInitial === "confirmee" ? new Date().toISOString() : null, confirmed_by: statutInitial === "confirmee" ? session.user.email.split("@")[0] : null },
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
  const coutLivraisons = workspace.activity_type === "retail" ? confirmees.filter((c) => c.mode_vente === "livraison" || c.mode_vente === "expedition").length * COUT_LIVRAISON : confirmees.length * COUT_LIVRAISON;

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

  const meilleurLivreur = useMemo(() => {
    if (depotsParLivreur.length === 0) return null;
    const avecTaux = depotsParLivreur.map((l) => {
      const total = livreursAvecCommandes.find((x) => x.nom === l.nom)?.total || l.livrees;
      return { ...l, taux: total > 0 ? Math.round((l.livrees / total) * 100) : 0, total };
    });
    return avecTaux.sort((a, b) => b.taux - a.taux)[0];
  }, [depotsParLivreur, livreursAvecCommandes]);

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
    return <ComptablePortalSaas workspace={workspace} commandes={commandes} livreurs={livreurs} produits={produits} />;
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
    <div style={{ minHeight: "100vh", background: "#FAFAF7", fontFamily: "'IBM Plex Sans', sans-serif", width: "100%", maxWidth: "100vw", overflowX: "hidden", boxSizing: "border-box" }}>
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
        .rv-saas-celebrate-in { animation: rvSaasCelebrateIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes rvSaasCelebrateIn {
          0% { opacity: 0; transform: scale(0.5) translateY(20px); }
          60% { opacity: 1; transform: scale(1.08) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .rv-saas-celebrate-out { animation: rvSaasCelebrateOut 0.35s ease forwards; }
        @keyframes rvSaasCelebrateOut {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.92) translateY(-10px); }
        }
        .rv-saas-confetti { animation: rvSaasConfetti 1.4s ease-out forwards; }
        @keyframes rvSaasConfetti {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(90px) rotate(360deg); opacity: 0; }
        }
        .rv-saas-sidebar { display: none; }
        .rv-saas-content { }
        .rv-saas-tabs-mobile { }
        .rv-saas-bottomnav { display: flex; }
        .rv-saas-content { padding-bottom: 76px; }
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
          .rv-saas-bottomnav { display: none !important; }
        }
      `}</style>

      <div className="rv-saas-sidebar">
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 18, color: "white", marginBottom: 28, padding: "0 8px" }}>
          RECU<span style={{ color: "#e8920a" }}>VENTE</span>
        </div>
        {[
          { key: "aujourdhui", label: "Aujourd'hui" },
          { key: "commandes", label: workspace.activity_type === "retail" ? "Ventes" : "Commandes" },
          { key: "validations", label: "Validations" },
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
        {(workspace.role === "owner" || workspace.role === "admin") && (
          <button
            onClick={() => setShowProduits(true)}
            style={{ display: "flex", alignItems: "center", padding: "11px 12px", borderRadius: 9, border: "none", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 500, textAlign: "left", marginBottom: 3, cursor: "pointer" }}
          >
            📦 Catalogue
          </button>
        )}
        {workspace.role === "owner" && (
          <>
            <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "10px 8px" }} />
            <button
              onClick={() => setShowTeam(true)}
              style={{ display: "flex", alignItems: "center", padding: "11px 12px", borderRadius: 9, border: "none", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 500, textAlign: "left", marginBottom: 3, cursor: "pointer" }}
            >
              👥 Gérer l'équipe
            </button>
            <button
              onClick={() => setShowIntegrations(true)}
              style={{ display: "flex", alignItems: "center", padding: "11px 12px", borderRadius: 9, border: "none", background: "rgba(232,146,10,0.15)", color: "#e8920a", fontSize: 14, fontWeight: 600, textAlign: "left", marginBottom: 3, cursor: "pointer" }}
            >
              🛍️ Ma Boutique
            </button>
            <button
              onClick={() => setShowAbonnement(true)}
              style={{ display: "flex", alignItems: "center", padding: "11px 12px", borderRadius: 9, border: "none", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 500, textAlign: "left", marginBottom: 3, cursor: "pointer" }}
            >
              💳 Mon abonnement
            </button>
            <button
              onClick={() => setShowAide(true)}
              style={{ display: "flex", alignItems: "center", padding: "11px 12px", borderRadius: 9, border: "none", background: "transparent", color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 500, textAlign: "left", marginBottom: 3, cursor: "pointer" }}
            >
              ❓ Aide
            </button>
          </>
        )}
        <div style={{ marginTop: "auto" }}>
          <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", padding: "8px 0", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.6)", fontWeight: 500, fontSize: 12.5, cursor: "pointer" }}>
            Déconnexion
          </button>
        </div>
      </div>

      <div className="rv-saas-content">

      <div style={{ background: "#1a7a3c", color: "white", padding: "20px 20px 34px", position: "relative", overflow: "hidden" }}>
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
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {workspace.role === "owner" && (
                <>
                  <button onClick={() => setShowTeam(true)} className="rv-saas-tabs-mobile" aria-label="Gérer l'équipe" style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 8px", borderRadius: 7, fontSize: 13, cursor: "pointer" }}>
                    👥
                  </button>
                  <button onClick={() => setShowProduits(true)} className="rv-saas-tabs-mobile" aria-label="Catalogue" style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 8px", borderRadius: 7, fontSize: 13, cursor: "pointer" }}>
                    📦
                  </button>
                  <button onClick={() => setShowAbonnement(true)} className="rv-saas-tabs-mobile" aria-label="Mon abonnement" style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 8px", borderRadius: 7, fontSize: 13, cursor: "pointer" }}>
                    💳
                  </button>
                  <button onClick={() => setShowIntegrations(true)} className="rv-saas-tabs-mobile" aria-label="Ma Boutique" style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 8px", borderRadius: 7, fontSize: 13, cursor: "pointer" }}>
                    🛍️
                  </button>
                </>
              )}
              <button onClick={() => supabase.auth.signOut()} aria-label="Déconnexion" style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                ⏻ Déconnexion
              </button>
            </div>
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

      <div style={{ padding: "0 20px 8px" }}>
      {retourPaiement && (
        <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 13, color: "#3B6D11" }}>
          ✅ Paiement reçu ! Ton abonnement s'active automatiquement, ça peut prendre quelques instants.
        </div>
      )}
      <SubscriptionBanner subscription={subscription} />

      {notifPermission === "default" && (
        <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 12, padding: "12px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "#8A6412" }}>🔔 Active les notifications pour ne rater aucune commande, même l'app fermée.</span>
          <button onClick={activerNotificationsPush} style={{ background: "#e8920a", color: "white", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
            Activer
          </button>
        </div>
      )}

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

      {vue === "aujourdhui" && (
        <div>
          {commandes.length === 0 && (
            <div style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 16, padding: "20px 18px", marginBottom: 20 }}>
              <div style={{ color: "white", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>👋 Bienvenue sur RecuVente !</div>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 12.5, marginBottom: 16 }}>3 étapes pour bien démarrer.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { n: "1", titre: "Ajoute ta première commande", desc: "Manuellement, ou connecte Shopify", action: () => setShowAdd(true), bouton: "+ Ajouter" },
                  { n: "2", titre: "Invite ton équipe", desc: "Livreurs, closers, comptable", action: () => setShowTeam(true), bouton: "Inviter" },
                  { n: "3", titre: "Connecte Shopify (optionnel)", desc: "Les commandes arriveront toutes seules", action: () => setShowIntegrations(true), bouton: "Voir" },
                ].map((etape) => (
                  <div key={etape.n} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,0.12)", color: "white", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {etape.n}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "white", fontWeight: 600, fontSize: 13 }}>{etape.titre}</div>
                      <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 11 }}>{etape.desc}</div>
                    </div>
                    <button onClick={etape.action} style={{ background: "rgba(255,255,255,0.14)", color: "white", border: "none", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                      {etape.bouton}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Aujourd'hui</div>
            {todoAujourdhui.total > 0 && (
              <button onClick={() => setShowBatch(true)} style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                📢 Relancer tout
              </button>
            )}
          </div>
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

      {(meilleurProduit || meilleurLivreur) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {meilleurProduit && (
            <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "#3B6D11" }}>🏆 Produit le plus vendu</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#3B6D11" }}>{meilleurProduit.nom} ({meilleurProduit.ventes})</span>
            </div>
          )}
          {produitPlusRentable && produitPlusRentable.nom !== meilleurProduit?.nom && (
            <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "#8A6412" }}>💰 Produit le plus rentable</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#8A6412" }}>{produitPlusRentable.nom}</span>
            </div>
          )}
          {meilleurLivreur && meilleurLivreur.total > 0 && (
            <div style={{ background: "#EAF7F1", border: "1px solid #C7E8D6", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "#1F9D6E" }}>🚀 Livreur le plus performant</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1F9D6E" }}>{meilleurLivreur.nom} ({meilleurLivreur.taux}%)</span>
            </div>
          )}
        </div>
      )}

      {clientsSuspects.length > 0 && (
        <div style={{ background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#D64933", marginBottom: 6 }}>⚠️ {clientsSuspects.length} client{clientsSuspects.length > 1 ? "s" : ""} avec 3+ échecs</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {clientsSuspects.slice(0, 5).map((c, i) => (
              <div key={i} style={{ fontSize: 12, color: "#B23A22" }}>
                <strong>{c.nom}</strong> ({c.tel}) — {c.echouees} échec{c.echouees > 1 ? "s" : ""} sur {c.total} commande{c.total > 1 ? "s" : ""}
              </div>
            ))}
          </div>
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
              <CommandeCard key={c.id} commande={c} currency={workspace.currency} onStatusChanged={loadCommandes} livreurs={livreurs} closers={closers} onAssignLivreur={assignLivreur} onAssignCloser={assignCloser} workspace={workspace} confirmateurNom={session.user.email.split("@")[0]} onCelebrate={(montant, client) => { setCelebration({ montant, client }); playCelebrationSound(); setTimeout(() => setCelebration(null), 2600); }} />
            ))}
          </div>
        </div>
      ))}
      </>
      )}

      {vue === "validations" && (
        <ValidationsViewSaas commandes={commandes} currency={workspace.currency} />
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
                    {i < 3 && cl.montantTotal > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#e8920a", background: "#FBF3E3", padding: "1px 7px", borderRadius: 999 }}>🏆 TOP CLIENT</span>}
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
              <CarteLivreursSaas livreurs={livreurs} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {livreurs.filter((l) => l.en_tournee).map((l) => (
                  <div key={l.id} style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{l.nom}</span>
                    {!l.position_lat && (
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

      </div>
      </div>

      <div
        className="rv-saas-bottomnav"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "white",
          borderTop: "1px solid #ECE8DC",
          padding: "8px 12px",
          paddingBottom: "calc(8px + env(safe-area-inset-bottom))",
          zIndex: 20,
        }}
      >
        {[
          { key: "aujourdhui", label: "Aujourd'hui", icon: ListChecks },
          { key: "commandes", label: "Commandes", icon: Package },
          { key: "validations", label: "Validations", icon: CheckCheck },
          { key: "clients", label: "Clients", icon: Users },
          ...(workspace.role === "owner" || workspace.role === "admin" ? [{ key: "compta", label: "Compta", icon: Calculator }] : []),
        ].map((t) => {
          const Icon = t.icon;
          const active = vue === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setVue(t.key)}
              style={{
                flex: 1,
                background: "none",
                border: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "6px 0",
                color: active ? "#1a7a3c" : "#8A9089",
                cursor: "pointer",
              }}
            >
              <Icon size={19} strokeWidth={active ? 2.4 : 2} />
              <span style={{ fontSize: 10, fontWeight: active ? 600 : 500 }}>{t.label}</span>
            </button>
          );
        })}
      </div>

      {celebration && <CelebrationOverlaySaas montant={celebration.montant} client={celebration.client} currency={workspace.currency} />}
      {showAdd && <AddCommandeModal onClose={() => setShowAdd(false)} onAdd={addCommande} currency={workspace.currency} activityType={workspace.activity_type} />}
      {showTeam && <TeamModal workspace={workspace} onClose={() => setShowTeam(false)} />}
      {showAbonnement && <AbonnementModal workspace={workspace} subscription={subscription} onClose={() => setShowAbonnement(false)} />}
      {showCampagne && <CampagneModalSaas clients={clients} workspace={workspace} onClose={() => setShowCampagne(false)} />}
      {showIntegrations && <IntegrationsModal workspace={workspace} onClose={() => setShowIntegrations(false)} />}
      {showAide && <AideModal onClose={() => setShowAide(false)} />}
      {showBatch && (
        <BatchRelanceModalSaas
          orders={[...todoAujourdhui.aRelivrer, ...todoAujourdhui.jamaisContactees, ...todoAujourdhui.sansNouvelles]}
          currency={workspace.currency}
          onClose={() => setShowBatch(false)}
          onLog={async (commandeId, note) => {
            await supabase.from("relances").insert([{ commande_id: commandeId, note }]);
            await loadAllRelances();
          }}
        />
      )}
      {showLivreurs && <EquipeModal titre="Livreurs" items={livreurs} onAdd={addLivreur} onDelete={deleteLivreur} onClose={() => setShowLivreurs(false)} avecEmail />}
      {showClosers && <EquipeModal titre="Closers" items={closers} onAdd={addCloser} onDelete={deleteCloser} onClose={() => setShowClosers(false)} avecEmail />}
      {showProduits && <ProduitsModal produits={produits} onAdd={addProduit} onUpdateCout={updateProduitCout} onUpdateStock={updateProduitStock} onUpdatePrixVente={updateProduitPrixVente} onUpdatePhoto={updateProduitPhoto} onUpdateDescription={updateProduitDescription} quantitesParProduit={quantitesParProduit} onDelete={deleteProduit} currency={workspace.currency} onClose={() => setShowProduits(false)} />}
    </div>
  );
}

function AddCommandeModal({ onClose, onAdd, currency, activityType }) {
  const estRetail = activityType === "retail";
  const champs = estRetail ? ["client", "tel", "produit", "montant"] : ["client", "tel", "produit", "montant", "zone"];
  const [form, setForm] = useState({ client: "", tel: "", produit: "", montant: "", zone: "", mode_vente: "sur_place", montant_paye: "" });
  const [modeRapide, setModeRapide] = useState(false);
  const montantValide = Number(form.montant) > 0;
  const canSubmit = form.client.trim() && montantValide;
  const montantPayeValide = form.montant_paye === "" || Number(form.montant_paye) <= Number(form.montant || 0);
  const champsRapides = ["client", "tel", "produit", "montant"];
  const inputRefs = useRef({});

  function focusNext(index) {
    const nextField = champsRapides[index + 1];
    if (nextField && inputRefs.current[nextField]) {
      inputRefs.current[nextField].focus();
    } else if (!nextField) {
      if (form.client.trim() && montantValide) onAdd({ ...form, mode_vente: "sur_place", montant_paye: "" });
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 360, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{estRetail ? "Nouvelle vente" : "Nouvelle commande"}</div>
          <button
            onClick={() => setModeRapide(!modeRapide)}
            style={{ background: modeRapide ? "#1a7a3c" : "#EEF0EA", color: modeRapide ? "white" : "#16231F", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
          >
            ⚡ Rapide
          </button>
        </div>

        {modeRapide ? (
          <>
            <div style={{ fontSize: 11.5, color: "#6B7168", marginBottom: 14 }}>Tape, appuie sur Entrée pour passer au champ suivant.</div>
            {champsRapides.map((f, i) => (
              <input
                key={f}
                ref={(el) => (inputRefs.current[f] = el)}
                autoFocus={i === 0}
                placeholder={f === "montant" ? `Montant (${currency})` : f === "produit" ? "Produit" : f === "tel" ? "Téléphone" : "Nom du client"}
                value={form[f]}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusNext(i); } }}
                type={f === "montant" ? "number" : "text"}
                min={f === "montant" ? "1" : undefined}
                style={inputStyle}
              />
            ))}
            {form.montant && !montantValide && (
              <div style={{ color: "#D64933", fontSize: 12, marginTop: -6, marginBottom: 10 }}>Le montant doit être supérieur à 0.</div>
            )}
            <button onClick={() => canSubmit && onAdd({ ...form, mode_vente: "sur_place", montant_paye: "" })} disabled={!canSubmit} style={btnStyle}>
              ⚡ Enregistrer
            </button>
          </>
        ) : (
          <>
        {!estRetail && <div style={{ marginBottom: 14 }} />}

        {estRetail && (
          <>
            <div style={{ fontSize: 12, color: "#6B7168", marginBottom: 14 }}>Comment ce produit sort-il du magasin ?</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              <button
                onClick={() => setForm({ ...form, mode_vente: "sur_place" })}
                style={{ flex: 1, padding: "10px 6px", borderRadius: 10, border: `2px solid ${form.mode_vente === "sur_place" ? "#1a7a3c" : "#DDD8CC"}`, background: form.mode_vente === "sur_place" ? "#EAF3DE" : "white", textAlign: "left", cursor: "pointer" }}
              >
                <div style={{ fontWeight: 700, fontSize: 12 }}>🏪 Sur place</div>
                <div style={{ fontSize: 10, color: "#6B7168" }}>Retrait magasin</div>
              </button>
              <button
                onClick={() => setForm({ ...form, mode_vente: "livraison" })}
                style={{ flex: 1, padding: "10px 6px", borderRadius: 10, border: `2px solid ${form.mode_vente === "livraison" ? "#e8920a" : "#DDD8CC"}`, background: form.mode_vente === "livraison" ? "#FBF3E3" : "white", textAlign: "left", cursor: "pointer" }}
              >
                <div style={{ fontWeight: 700, fontSize: 12 }}>🚚 Livraison</div>
                <div style={{ fontSize: 10, color: "#6B7168" }}>Livreur (Abidjan)</div>
              </button>
              <button
                onClick={() => setForm({ ...form, mode_vente: "expedition" })}
                style={{ flex: 1, padding: "10px 6px", borderRadius: 10, border: `2px solid ${form.mode_vente === "expedition" ? "#2452E8" : "#DDD8CC"}`, background: form.mode_vente === "expedition" ? "#EAF0FB" : "white", textAlign: "left", cursor: "pointer" }}
              >
                <div style={{ fontWeight: 700, fontSize: 12 }}>📦 Expédition</div>
                <div style={{ fontSize: 10, color: "#6B7168" }}>Hors Abidjan</div>
              </button>
            </div>

            {form.mode_vente === "expedition" && (
              <input
                placeholder="Ville de destination"
                value={form.ville_expedition || ""}
                onChange={(e) => setForm({ ...form, ville_expedition: e.target.value })}
                style={inputStyle}
              />
            )}
          </>
        )}

        {champs.map((f) => (
          <input
            key={f}
            placeholder={f === "montant" ? `Montant total (${currency})` : f === "produit" && estRetail ? "Produit vendu" : f}
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

        {estRetail && (
          <div>
            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Montant déjà payé (FCFA)</label>
            <input
              value={form.montant_paye}
              onChange={(e) => setForm({ ...form, montant_paye: e.target.value })}
              type="number"
              placeholder={`Laisse vide si payé en entier (${form.montant || 0})`}
              style={inputStyle}
            />
            {!montantPayeValide && (
              <div style={{ color: "#D64933", fontSize: 11.5, marginTop: -6, marginBottom: 10 }}>Le montant payé ne peut pas dépasser le montant total.</div>
            )}
            <div style={{ fontSize: 11, color: "#8A9089", marginTop: -4, marginBottom: 10 }}>
              Laisse vide ou égal au montant total si le client a payé en entier — sinon indique l'acompte reçu.
            </div>
          </div>
        )}

        <button onClick={() => canSubmit && montantPayeValide && onAdd(form)} disabled={!canSubmit || !montantPayeValide} style={btnStyle}>
          {estRetail ? "Enregistrer la vente" : "Ajouter"}
        </button>
          </>
        )}
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
    const res = await fetch(`/api/team?workspaceId=${workspace.id}`, {
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
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token}` },
      body: JSON.stringify({ action: "remove", workspaceId: workspace.id, memberUserId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) alert(json.error || "Erreur lors du retrait");
    else await loadMembers();
    setRetraitEnCours(null);
  }

  const roleLabels = { owner: "Propriétaire", admin: "Admin", closer: "Closer", livreur: "Livreur", comptable: "Comptable" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={onClose}>
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
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token}` },
        body: JSON.stringify({ action: "invite", workspaceId: workspace.id, email, password, role }),
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 55 }} onClick={onClose}>
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
  const [recherche, setRecherche] = useState("");
  const [actionEnCours, setActionEnCours] = useState(null);
  const [exportEnCours, setExportEnCours] = useState(false);

  async function exporterSauvegarde() {
    setExportEnCours(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/backup-export", {
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error || "Erreur lors de l'export");
        setExportEnCours(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recuvente-saas-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Erreur: " + e.message);
    }
    setExportEnCours(false);
  }

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

  async function toggleStatus(workspaceId, action) {
    setActionEnCours(workspaceId);
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch("/api/toggle-workspace-status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token}` },
      body: JSON.stringify({ workspaceId, action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) alert(json.error || "Erreur");
    else await load();
    setActionEnCours(null);
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
      <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 12 }}>Connecté en tant que {session.user.email}</div>

      <button
        onClick={exporterSauvegarde}
        disabled={exportEnCours}
        style={{ background: "#16231F", color: "white", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 20 }}
      >
        {exportEnCours ? "Export en cours..." : "💾 Télécharger une sauvegarde complète"}
      </button>

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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Toutes les entreprises</div>
        <input
          type="text"
          placeholder="Rechercher..."
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 12.5, width: 160 }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.workspaces
          .filter((ws) => !recherche.trim() || ws.name.toLowerCase().includes(recherche.toLowerCase()) || ws.ownerEmail.toLowerCase().includes(recherche.toLowerCase()))
          .map((ws) => {
            const suspendu = ws.subscription?.status === "suspended";
            return (
              <div key={ws.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{ws.name}</div>
                    <div style={{ fontSize: 11.5, color: "#6B7168" }}>{ws.ownerEmail} · {ws.nbMembres} membre{ws.nbMembres > 1 ? "s" : ""} · {ws.country}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {ws.subscription ? statusLabels[ws.subscription.status] || ws.subscription.status : "—"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {ws.subscription && (
                    <button
                      onClick={() => toggleStatus(ws.id, suspendu ? "reactiver" : "suspendre")}
                      disabled={actionEnCours === ws.id}
                      style={{ background: suspendu ? "#1a7a3c" : "#FBEAE6", color: suspendu ? "white" : "#D64933", border: suspendu ? "none" : "1px solid #F0B8AC", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                    >
                      {actionEnCours === ws.id ? "..." : suspendu ? "✅ Réactiver" : "🔒 Suspendre"}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (window.confirm(`Supprimer définitivement "${ws.name}" ?\n\nToutes ses commandes, clients et données seront perdues pour toujours. Cette action est IRRÉVERSIBLE.`)) {
                        if (window.confirm(`Dernière confirmation — es-tu vraiment sûr de vouloir supprimer "${ws.name}" ?`)) {
                          toggleStatus(ws.id, "supprimer");
                        }
                      }
                    }}
                    disabled={actionEnCours === ws.id}
                    style={{ background: "white", color: "#8A9089", border: "1px solid #DDD8CC", borderRadius: 7, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    🗑️ Supprimer
                  </button>
                </div>
              </div>
            );
          })}
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
  const [exportEnCours, setExportEnCours] = useState(false);
  const [planEnAttenteInfos, setPlanEnAttenteInfos] = useState(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  async function exporterMesDonnees() {
    setExportEnCours(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch(`/api/export-my-data?workspaceId=${workspace.id}`, {
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error || "Erreur lors de l'export");
        setExportEnCours(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workspace.name}-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Erreur: " + e.message);
    }
    setExportEnCours(false);
  }

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

  function demander(planId) {
    setPlanEnAttenteInfos(planId);
  }

  async function confirmerEtPayer() {
    if (!firstName.trim() || !lastName.trim() || !phone.trim()) {
      setMessage("Remplis ton prénom, nom et téléphone pour continuer.");
      return;
    }
    const chiffresTelephone = phone.replace(/\D/g, "");
    if (chiffresTelephone.length < 10) {
      setMessage("Le numéro de téléphone semble incomplet (10 chiffres attendus, ex: 0708090910). Vérifie-le et réessaie.");
      return;
    }
    const planId = planEnAttenteInfos;
    setLoading(planId);
    setMessage("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/chariow", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token}` },
        body: JSON.stringify({ planId, firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() }),
      });

      const texteBrut = await res.text();
      let json;
      try {
        json = JSON.parse(texteBrut);
      } catch {
        json = null;
      }

      if (res.ok && json?.url) {
        window.location.href = json.url;
        return;
      }

      const detailErreur = json?.error || texteBrut.slice(0, 200) || "aucun détail";
      console.error("Erreur paiement Chariow — statut:", res.status, "contenu:", texteBrut);
      setMessage(`⚠️ Échec (code ${res.status}) : ${detailErreur}. Bascule sur le système manuel.`);

      await supabase.from("upgrade_requests").update({ statut: "annule" }).eq("workspace_id", workspace.id).eq("statut", "en_attente");
      await supabase.from("upgrade_requests").insert([{ workspace_id: workspace.id, plan_id: planId }]);
      await load();
      setPlanEnAttenteInfos(null);
    } catch (e) {
      setMessage("Erreur réseau: " + e.message);
    }
    setLoading(null);
  }

  const planActuel = subscription?.subscription_plans?.nom;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 400, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Mon abonnement</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        {planEnAttenteInfos ? (
          <div>
            <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 14 }}>
              Quelques infos nécessaires pour le paiement en ligne.
            </div>
            <input placeholder="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
            <input placeholder="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
            <input placeholder="Téléphone (ex: 0708090910)" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            {message && <div style={{ color: "#D64933", fontSize: 12.5, marginBottom: 10 }}>{message}</div>}
            <button onClick={confirmerEtPayer} disabled={loading === planEnAttenteInfos} style={btnStyle}>
              {loading === planEnAttenteInfos ? "..." : "Continuer vers le paiement"}
            </button>
            <button
              onClick={() => setPlanEnAttenteInfos(null)}
              style={{ width: "100%", marginTop: 8, padding: "10px 0", borderRadius: 10, border: "1px solid #DDD8CC", background: "white", color: "#6B7168", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              ← Retour
            </button>
          </div>
        ) : (
        <>
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
                disabled={loading === p.id || demandeEnAttente?.plan_id === p.id}
                style={{ width: "100%", marginTop: 10, padding: "9px 0", borderRadius: 8, border: "none", background: p.nom === planActuel ? "#DDD8CC" : "#1a7a3c", color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
              >
                {loading === p.id ? "..." : demandeEnAttente?.plan_id === p.id ? "⏳ En attente" : p.nom === planActuel ? "Plan actuel" : "Demander ce plan"}
              </button>
            </div>
          ))}
        </div>

        {demandes.length > 0 && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #F0EEE6" }}>
            <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", marginBottom: 8 }}>Historique</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {demandes.map((d) => {
                const statutInfo = {
                  en_attente: { label: "⏳ En attente", couleur: "#8A6412", fond: "#FBF3E3" },
                  confirmee: { label: "✅ Confirmé", couleur: "#3B6D11", fond: "#EAF3DE" },
                  refuse: { label: "❌ Refusé", couleur: "#B23A22", fond: "#FBEAE6" },
                  annule: { label: "Remplacée par une autre demande", couleur: "#8A9089", fond: "#FAFAF7" },
                }[d.statut] || { label: d.statut, couleur: "#6B7168", fond: "#FAFAF7" };
                return (
                  <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, padding: "8px 10px", background: "#FAFAF7", borderRadius: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{d.subscription_plans?.nom || "Plan"}</div>
                      <div style={{ fontSize: 11, color: "#8A9089" }}>{new Date(d.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: statutInfo.couleur, background: statutInfo.fond, padding: "3px 9px", borderRadius: 999 }}>
                      {statutInfo.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #F0EEE6" }}>
          <button
            onClick={exporterMesDonnees}
            disabled={exportEnCours}
            style={{ width: "100%", background: "#FAFAF7", border: "1px solid #DDD8CC", color: "#16231F", padding: "10px 0", borderRadius: 10, fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}
          >
            {exportEnCours ? "Export en cours..." : "💾 Télécharger toutes mes données"}
          </button>
          <div style={{ fontSize: 11, color: "#8A9089", marginTop: 6, textAlign: "center" }}>
            Commandes, clients, équipe — au format que tu peux garder.
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

function DemandeCard({ demande, onConfirmed }) {
  const [loading, setLoading] = useState(false);

  async function confirmer() {
    const confirme = window.confirm(
      `⚠️ Confirmes-tu avoir reçu ${Number(demande.subscription_plans?.prix).toLocaleString("fr-FR")} ${demande.subscription_plans?.devise} de la part de "${demande.workspaceName}" ?\n\nCette demande apparaît uniquement parce que le paiement automatique (Chariow) a échoué pour ce client. Ne clique "OK" que si tu as vraiment reçu l'argent (Mobile Money, virement, etc.) — sinon annule et vérifie d'abord avec le client.`
    );
    if (!confirme) return;
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

function CommandeCard({ commande, currency, onStatusChanged, livreurs = [], closers = [], onAssignLivreur, onAssignCloser, workspace, confirmateurNom, onCelebrate }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ client: commande.client, tel: commande.tel, produit: commande.produit, montant: commande.montant, zone: commande.zone, mode_vente: commande.mode_vente || "sur_place", montant_paye: commande.montant_paye ?? "", ville_expedition: commande.ville_expedition || "" });
  const s = STATUTS[commande.statut] || STATUTS.en_cours;

  async function enregistrerInfos() {
    setLoading(true);
    const infos = { client: form.client, tel: form.tel, produit: form.produit, montant: Number(form.montant), zone: form.zone, mode_vente: form.mode_vente, montant_paye: Number(form.montant_paye) || 0, ville_expedition: form.ville_expedition || null };
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
    if (nouveauStatut === "confirmee" && workspace?.activity_type === "retail" && Number(commande.montant_paye || 0) < Number(commande.montant)) {
      alert("⛔ Impossible de confirmer : le solde n'est pas entièrement payé.");
      return;
    }
    setLoading(true);
    const ancienStatut = commande.statut;
    const vraimentRecuperee = nouveauStatut === "confirmee" && ancienStatut === "echouee";
    const infosValidation = nouveauStatut === "confirmee" ? { confirmed_at: new Date().toISOString(), confirmed_by: confirmateurNom || "Admin" } : {};
    const { error } = await supabase.from("commandes").update({ statut: nouveauStatut, ...infosValidation }).eq("id", commande.id);
    if (error) {
      alert("Erreur: " + error.message);
    } else {
      await supabase.from("relances").insert([
        { commande_id: commande.id, note: `📋 Statut : ${STATUTS[ancienStatut]?.label || ancienStatut} → ${STATUTS[nouveauStatut]?.label || nouveauStatut}${nouveauStatut === "confirmee" ? ` par ${confirmateurNom || "Admin"}` : ""}` },
      ]);
      await onStatusChanged();
      if (vraimentRecuperee && onCelebrate) onCelebrate(commande.montant, commande.client);
    }
    setLoading(false);
    setOpen(false);
  }

  async function enregistrerPaiement() {
    const montant = prompt("Montant reçu maintenant (FCFA) :");
    if (!montant || Number(montant) <= 0) return;
    const nouveauMontantPaye = Number(commande.montant_paye || 0) + Number(montant);
    setLoading(true);
    const { error } = await supabase.from("commandes").update({ montant_paye: nouveauMontantPaye }).eq("id", commande.id);
    if (error) {
      alert("Erreur: " + error.message);
    } else {
      await supabase.from("relances").insert([{ commande_id: commande.id, note: `💰 Paiement reçu : ${Number(montant).toLocaleString("fr-FR")} FCFA (total payé : ${nouveauMontantPaye.toLocaleString("fr-FR")})` }]);
      await onStatusChanged();
    }
    setLoading(false);
  }

  async function confirmerDepotRecu() {
    setLoading(true);
    const { error } = await supabase.from("commandes").update({ depot_recu_closer: true }).eq("id", commande.id);
    if (error) {
      alert("Erreur: " + error.message);
    } else {
      await supabase.from("relances").insert([{ commande_id: commande.id, note: `📦 Dépôt reçu du client, colis prêt pour expédition${commande.ville_expedition ? ` vers ${commande.ville_expedition}` : ""}` }]);
      await onStatusChanged();
    }
    setLoading(false);
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
          {workspace?.activity_type === "retail" && (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <button
                  onClick={() => setForm({ ...form, mode_vente: "sur_place" })}
                  style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: `1px solid ${form.mode_vente === "sur_place" ? "#1a7a3c" : "#DDD8CC"}`, background: form.mode_vente === "sur_place" ? "#EAF3DE" : "white", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                >
                  🏪 Sur place
                </button>
                <button
                  onClick={() => setForm({ ...form, mode_vente: "livraison" })}
                  style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: `1px solid ${form.mode_vente === "livraison" ? "#e8920a" : "#DDD8CC"}`, background: form.mode_vente === "livraison" ? "#FBF3E3" : "white", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                >
                  🚚 Livraison
                </button>
                <button
                  onClick={() => setForm({ ...form, mode_vente: "expedition" })}
                  style={{ flex: 1, padding: "7px 4px", borderRadius: 7, border: `1px solid ${form.mode_vente === "expedition" ? "#2452E8" : "#DDD8CC"}`, background: form.mode_vente === "expedition" ? "#EAF0FB" : "white", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                >
                  📦 Expédition
                </button>
              </div>
              {form.mode_vente === "expedition" && (
                <input
                  placeholder="Ville de destination"
                  value={form.ville_expedition || ""}
                  onChange={(e) => setForm({ ...form, ville_expedition: e.target.value })}
                  style={{ ...inputStyle, marginBottom: 6, padding: "7px 9px", fontSize: 13 }}
                />
              )}
              <input
                placeholder="Montant payé"
                value={form.montant_paye}
                onChange={(e) => setForm({ ...form, montant_paye: e.target.value })}
                type="number"
                style={{ ...inputStyle, marginBottom: 6, padding: "7px 9px", fontSize: 13 }}
              />
            </>
          )}
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
            {workspace?.activity_type === "retail" && commande.statut === "en_cours" && Number(commande.montant_paye || 0) < Number(commande.montant) && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "#B23A22", background: "#FBEAE6", padding: "2px 8px", borderRadius: 999 }}>
                💰 Solde : {(Number(commande.montant) - Number(commande.montant_paye || 0)).toLocaleString("fr-FR")} {currency}
              </span>
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

          {workspace?.activity_type === "retail" && Number(commande.montant_paye || 0) < Number(commande.montant) && (
            <button
              onClick={enregistrerPaiement}
              disabled={loading}
              style={{ width: "100%", background: "#1a7a3c", color: "white", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 10 }}
            >
              💰 Enregistrer un paiement (solde : {(Number(commande.montant) - Number(commande.montant_paye || 0)).toLocaleString("fr-FR")} {currency})
            </button>
          )}

          {workspace?.activity_type === "retail" && commande.mode_vente === "expedition" && (
            <>
              {!commande.depot_recu_closer ? (
                <button
                  onClick={confirmerDepotRecu}
                  disabled={loading}
                  style={{ width: "100%", background: "#2452E8", color: "white", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 10 }}
                >
                  📦 Confirmer dépôt reçu du client{commande.ville_expedition ? ` (→ ${commande.ville_expedition})` : ""}
                </button>
              ) : (
                <div style={{ background: "#EAF0FB", border: "1px solid #C3D4F0", borderRadius: 8, padding: "9px 12px", marginBottom: 10, fontSize: 12, color: "#1E4B8C", fontWeight: 600 }}>
                  ✅ Dépôt reçu — colis remis au livreur pour {commande.ville_expedition || "expédition"}
                </div>
              )}

              {commande.photo_recu_expedition && (
                <>
                  <img
                    src={commande.photo_recu_expedition}
                    alt="Reçu d'expédition"
                    style={{ width: "100%", borderRadius: 8, marginBottom: 8, border: "1px solid #ECE8DC" }}
                  />
                  <a
                    href={`https://wa.me/${cleanPhoneForWhatsApp(commande.tel)}?text=${encodeURIComponent(`Bonjour ${(commande.client || "").split(" ")[0]} 👋, voici votre reçu d'expédition pour retirer votre colis à ${commande.ville_expedition || "destination"} :\n\n${commande.photo_recu_expedition}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "block", textAlign: "center", width: "100%", background: "#1F9D6E", color: "white", padding: "9px 0", borderRadius: 8, fontWeight: 700, fontSize: 12.5, cursor: "pointer", marginBottom: 10, textDecoration: "none", boxSizing: "border-box" }}
                  >
                    💬 Envoyer le reçu au client (WhatsApp)
                  </a>
                </>
              )}
            </>
          )}

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
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={onClose}>
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

function ProduitsModal({ produits, onAdd, onUpdateCout, onUpdateStock, onUpdatePrixVente, onUpdatePhoto, onUpdateDescription, quantitesParProduit, onDelete, currency, onClose }) {
  const [nom, setNom] = useState("");
  const [cout, setCout] = useState("");
  const [editId, setEditId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editStockId, setEditStockId] = useState(null);
  const [editStockValue, setEditStockValue] = useState("");
  const [editPrixId, setEditPrixId] = useState(null);
  const [editPrixValue, setEditPrixValue] = useState("");
  const [editPhotoId, setEditPhotoId] = useState(null);
  const [editPhotoValue, setEditPhotoValue] = useState("");
  const [editDescId, setEditDescId] = useState(null);
  const [editDescValue, setEditDescValue] = useState("");
  const [photoEnvoiId, setPhotoEnvoiId] = useState(null);

  async function envoyerPhoto(produitId, fichier) {
    if (!fichier) return;
    if (fichier.size > 5 * 1024 * 1024) {
      alert("L'image est trop lourde (max 5 Mo). Choisis une photo plus légère.");
      return;
    }
    setPhotoEnvoiId(produitId);
    const extension = fichier.name.split(".").pop();
    const chemin = `${produitId}-${Date.now()}.${extension}`;
    const { error: erreurUpload } = await supabase.storage.from("produits").upload(chemin, fichier, { upsert: true });
    if (erreurUpload) {
      alert("Erreur lors de l'envoi de la photo : " + erreurUpload.message);
      setPhotoEnvoiId(null);
      return;
    }
    const { data } = supabase.storage.from("produits").getPublicUrl(chemin);
    await onUpdatePhoto(produitId, data.publicUrl);
    setPhotoEnvoiId(null);
  }

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
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={onClose}>
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
                    {editPrixId === p.id ? (
                      <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                        <input type="number" value={editPrixValue} onChange={(e) => setEditPrixValue(e.target.value)} autoFocus placeholder="Prix de vente" style={{ flex: 1, padding: "5px 7px", borderRadius: 6, border: "1px solid #DDD8CC", fontSize: 12 }} />
                        <button onClick={() => { onUpdatePrixVente(p.id, editPrixValue); setEditPrixId(null); }} style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 6, padding: "0 9px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>OK</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditPrixId(p.id); setEditPrixValue(String(p.prix_vente || "")); }} style={{ background: "none", border: "none", padding: 0, marginTop: 2, fontSize: 12, color: p.prix_vente ? "#1a7a3c" : "#D64933", textDecoration: "underline", cursor: "pointer" }}>
                        {p.prix_vente ? `Prix de vente : ${Number(p.prix_vente).toLocaleString("fr-FR")} ${currency}` : "⚠️ Ajouter un prix de vente (pour le catalogue)"}
                      </button>
                    )}
                    {photoEnvoiId === p.id ? (
                      <div style={{ fontSize: 11.5, color: "#8A9089", marginTop: 4 }}>Envoi de la photo...</div>
                    ) : (
                      <label style={{ display: "inline-block", marginTop: 2, fontSize: 12, color: "#6B7168", textDecoration: "underline", cursor: "pointer" }}>
                        {p.photo_url ? "📷 Changer la photo" : "📷 Ajouter une photo (optionnel)"}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={(e) => envoyerPhoto(p.id, e.target.files?.[0])}
                        />
                      </label>
                    )}
                    {editDescId === p.id ? (
                      <div style={{ marginTop: 6 }}>
                        <textarea
                          value={editDescValue}
                          onChange={(e) => setEditDescValue(e.target.value)}
                          autoFocus
                          rows={2}
                          placeholder="Description visible par les clients en boutique"
                          style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #DDD8CC", fontSize: 12, boxSizing: "border-box", fontFamily: "inherit" }}
                        />
                        <button onClick={() => { onUpdateDescription(p.id, editDescValue); setEditDescId(null); }} style={{ marginTop: 4, background: "#1a7a3c", color: "white", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>OK</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditDescId(p.id); setEditDescValue(p.description || ""); }} style={{ display: "block", background: "none", border: "none", padding: 0, marginTop: 4, fontSize: 12, color: p.description ? "#6B7168" : "#D64933", textDecoration: "underline", cursor: "pointer", textAlign: "left" }}>
                        {p.description ? "📝 " + p.description.slice(0, 40) + (p.description.length > 40 ? "..." : "") : "📝 Ajouter une description (pour la boutique)"}
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
  const actives_livraison = actives.filter((c) => c.mode_vente !== "expedition");
  const actives_expedition = actives.filter((c) => c.mode_vente === "expedition");
  const confirmees = commandes.filter((c) => c.statut === "confirmee");
  const [ongletActif, setOngletActif] = useState("livraison");
  const [envoiPhotoId, setEnvoiPhotoId] = useState(null);

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

  async function confirmerExpedition(commandeId, fichierPhoto) {
    if (!fichierPhoto) return;
    if (fichierPhoto.size > 5 * 1024 * 1024) {
      alert("La photo est trop lourde (max 5 Mo). Choisis une photo plus légère.");
      return;
    }
    setEnvoiPhotoId(commandeId);
    const extension = fichierPhoto.name.split(".").pop();
    const chemin = `${commandeId}-${Date.now()}.${extension}`;
    const { error: erreurUpload } = await supabase.storage.from("expeditions").upload(chemin, fichierPhoto, { upsert: true });
    if (erreurUpload) {
      alert("Erreur lors de l'envoi de la photo : " + erreurUpload.message);
      setEnvoiPhotoId(null);
      return;
    }
    const { data } = supabase.storage.from("expeditions").getPublicUrl(chemin);
    await supabase.from("commandes").update({
      photo_recu_expedition: data.publicUrl,
      expedition_confirmee: true,
      expedition_confirmee_le: new Date().toISOString(),
      statut: "confirmee",
      confirmed_at: new Date().toISOString(),
      confirmed_by: livreur.nom,
    }).eq("id", commandeId);
    await supabase.from("relances").insert([{ commande_id: commandeId, note: `📦 Expédition confirmée par ${livreur.nom}, reçu photographié` }]);
    await onStatusChanged();
    setEnvoiPhotoId(null);
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
        {actives_expedition.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              onClick={() => setOngletActif("livraison")}
              style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${ongletActif === "livraison" ? "#1a7a3c" : "#DDD8CC"}`, background: ongletActif === "livraison" ? "#1a7a3c" : "white", color: ongletActif === "livraison" ? "white" : "#16231F", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              🚚 Livraisons ({actives_livraison.length})
            </button>
            <button
              onClick={() => setOngletActif("expedition")}
              style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${ongletActif === "expedition" ? "#2452E8" : "#DDD8CC"}`, background: ongletActif === "expedition" ? "#2452E8" : "white", color: ongletActif === "expedition" ? "white" : "#16231F", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              📦 Expéditions ({actives_expedition.length})
            </button>
          </div>
        )}

        {ongletActif === "livraison" && (
        actives_livraison.length === 0 ? (
          <div style={{ textAlign: "center", padding: "50px 20px", color: "#8A9089" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
            <div style={{ fontSize: 14 }}>Aucune commande à traiter pour le moment.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {actives_livraison.map((c) => (
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
        )
        )}

        {ongletActif === "expedition" && (
          actives_expedition.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 20px", color: "#8A9089" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📦</div>
              <div style={{ fontSize: 14 }}>Aucun colis à expédier pour le moment.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {actives_expedition.map((c) => (
                <div key={c.id} style={{ background: "white", border: "1px solid #ECE8DC", borderLeft: "4px solid #2452E8", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontWeight: 700, fontSize: 15.5 }}>{c.client}</div>
                  <div style={{ fontSize: 13, color: "#6B7168", marginTop: 3 }}>{c.produit}</div>
                  <div style={{ fontSize: 13, color: "#2452E8", marginTop: 2, fontWeight: 600 }}>📦 Destination : {c.ville_expedition || "non précisée"}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 17, marginTop: 8, color: "#1a7a3c" }}>{Number(c.montant).toLocaleString("fr-FR")} {currency}</div>

                  {!c.depot_recu_closer && (
                    <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 8, padding: "8px 10px", marginTop: 10, fontSize: 11.5, color: "#8A6412" }}>
                      ⏳ En attente — le closer doit d'abord confirmer avoir reçu le dépôt du client.
                    </div>
                  )}

                  {c.depot_recu_closer && !c.expedition_confirmee && (
                    <label style={{ display: "block", textAlign: "center", width: "100%", background: "#2452E8", color: "white", padding: "11px 0", borderRadius: 9, fontWeight: 700, fontSize: 13.5, cursor: "pointer", marginTop: 12, boxSizing: "border-box" }}>
                      {envoiPhotoId === c.id ? "Envoi en cours..." : "📷 Confirmer l'expédition (photo du reçu)"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: "none" }}
                        onChange={(e) => confirmerExpedition(c.id, e.target.files?.[0])}
                      />
                    </label>
                  )}

                  {c.expedition_confirmee && (
                    <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 8, padding: "9px 12px", marginTop: 10, fontSize: 12.5, color: "#3B6D11", fontWeight: 600, textAlign: "center" }}>
                      ✅ Expédition confirmée
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ComptablePortalSaas({ workspace, commandes, livreurs, produits }) {
  const [datePreset, setDatePreset] = useState("semaine");
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
    } else if (datePreset === "avanthier") {
      start = new Date(startOfToday.getTime() - 2 * 86400000);
      end = new Date(startOfToday.getTime() - 86400000);
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

  const periodLabel = { aujourdhui: "Aujourd'hui", hier: "Hier", avanthier: "Avant-hier", semaine: "Cette semaine", mois: "Ce mois", personnalise: "Période personnalisée" }[datePreset];

  function parseProduitTexteLocal(texte) {
    if (!texte) return { nom: "", quantite: 1 };
    const match = texte.match(/^(.*?)\s*x\s*(\d+)\s*$/i);
    if (match) return { nom: match[1].trim(), quantite: Number(match[2]) || 1 };
    return { nom: texte.trim(), quantite: 1 };
  }

  const commandesInRange = useMemo(() => {
    return commandes.filter((c) => {
      const d = new Date(c.created_at);
      return d >= dateRange.start && d < dateRange.end;
    });
  }, [commandes, dateRange]);

  const confirmees = commandesInRange.filter((c) => c.statut === "confirmee");
  const caConfirme = confirmees.reduce((s, c) => s + Number(c.montant), 0);
  const COUT_LIVRAISON = 1500;
  const coutLivraisons = workspace.activity_type === "retail" ? confirmees.filter((c) => c.mode_vente === "livraison" || c.mode_vente === "expedition").length * COUT_LIVRAISON : confirmees.length * COUT_LIVRAISON;

  const coutProduitsInfo = useMemo(() => {
    let coutTotal = 0, nbInconnu = 0, montantInconnu = 0;
    confirmees.forEach((c) => {
      const { nom, quantite } = parseProduitTexteLocal(c.produit);
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

  const livreursAvecCommandes = useMemo(() => {
    const map = {};
    commandesInRange.forEach((c) => {
      if (!c.livreur) return;
      map[c.livreur] = (map[c.livreur] || 0) + 1;
    });
    return Object.entries(map).map(([nom, total]) => ({ nom, total })).sort((a, b) => b.total - a.total);
  }, [commandesInRange]);

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
    <div className="rv-saas-print-scope" style={{ minHeight: "100vh", background: "#FAFAF7", fontFamily: "'IBM Plex Sans', sans-serif", padding: 24 }}>
      <style>{`
        @keyframes rvPulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @media print {
          .rv-saas-no-print { display: none !important; }
          .rv-saas-print-only { display: block !important; }
          body { background: white !important; }
          * { box-shadow: none !important; }
        }
      `}</style>

      <div className="rv-saas-no-print" style={{ background: "#16231F", color: "white", padding: 20, borderRadius: 14, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, opacity: 0.75 }}>🧮 Comptabilité — {workspace.name}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => window.print()} style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 10px", borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
              🖨️
            </button>
            <button onClick={() => supabase.auth.signOut()} style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
              Déconnexion
            </button>
          </div>
        </div>
      </div>

      <div className="rv-saas-print-only" style={{ display: "none", marginBottom: 16 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 20 }}>Rapport comptable — {workspace.name}</div>
        <div style={{ fontSize: 12, color: "#6B7168" }}>Édité le {new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} — {periodLabel}</div>
      </div>

      <div className="rv-saas-no-print" style={{ display: "flex", gap: 6, marginBottom: 16, overflowX: "auto" }}>
        {[
          { key: "aujourdhui", label: "Aujourd'hui" },
          { key: "hier", label: "Hier" },
          { key: "avanthier", label: "Avant-hier" },
          { key: "semaine", label: "Cette semaine" },
          { key: "mois", label: "Ce mois" },
          { key: "personnalise", label: "Personnalisé" },
        ].map((d) => (
          <button
            key={d.key}
            onClick={() => setDatePreset(d.key)}
            style={{ padding: "6px 13px", borderRadius: 999, border: `1px solid ${datePreset === d.key ? "#1a7a3c" : "#DDD8CC"}`, background: datePreset === d.key ? "#1a7a3c" : "white", color: datePreset === d.key ? "white" : "#16231F", fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" }}
          >
            {d.label}
          </button>
        ))}
      </div>

      {datePreset === "personnalise" && (
        <div className="rv-saas-no-print" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }} />
          <span style={{ color: "#8A9089", fontSize: 12 }}>à</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }} />
        </div>
      )}

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
        <div className="rv-saas-no-print" style={{ marginBottom: 20 }}>
          <CarteLivreursSaas livreurs={livreurs} />
        </div>
      )}

      {livreursAvecCommandes.length > 0 && (
        <div style={{ marginBottom: 20 }}>
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

      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>Détail par livreur</div>
      {depotsParLivreur.length === 0 && <div style={{ color: "#8A9089", fontSize: 13 }}>Aucune livraison confirmée sur cette période.</div>}
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
  const [datePreset, setDatePreset] = useState("toutes");
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
    } else if (datePreset === "avanthier") {
      start = new Date(startOfToday.getTime() - 2 * 86400000);
      end = new Date(startOfToday.getTime() - 86400000);
    } else if (datePreset === "semaine") {
      const day = startOfToday.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start = new Date(startOfToday.getTime() - diff * 86400000);
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

  const mesCommandesToutes = commandes.filter((c) => c.closer === closer.nom);
  const actives = mesCommandesToutes.filter((c) => {
    if (c.statut !== "en_cours" && c.statut !== "echouee") return false;
    const d = new Date(c.created_at);
    return d >= dateRange.start && d < dateRange.end;
  });
  const confirmees = mesCommandesToutes.filter((c) => c.statut === "confirmee");
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

        <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto" }}>
          {[
            { key: "toutes", label: "Toutes" },
            { key: "aujourdhui", label: "Aujourd'hui" },
            { key: "hier", label: "Hier" },
            { key: "avanthier", label: "Avant-hier" },
            { key: "semaine", label: "Cette semaine" },
            { key: "personnalise", label: "Personnalisé" },
          ].map((d) => (
            <button
              key={d.key}
              onClick={() => setDatePreset(d.key)}
              style={{ padding: "6px 13px", borderRadius: 999, border: `1px solid ${datePreset === d.key ? "#1a7a3c" : "#DDD8CC"}`, background: datePreset === d.key ? "#1a7a3c" : "white", color: datePreset === d.key ? "white" : "#16231F", fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" }}
            >
              {d.label}
            </button>
          ))}
        </div>

        {datePreset === "personnalise" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }} />
            <span style={{ color: "#8A9089", fontSize: 12 }}>à</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }} />
          </div>
        )}

        <div style={{ fontSize: 12.5, color: "#8A9089", marginBottom: 10 }}>
          {actives.length} commande{actives.length > 1 ? "s" : ""} à traiter{datePreset !== "toutes" ? " sur cette période" : ""}
        </div>

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

function BatchRelanceModalSaas({ orders, currency, onClose, onLog }) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState([]);
  const current = orders[index];
  const finished = index >= orders.length;

  function next() {
    setIndex((i) => i + 1);
  }

  async function sendAndLog() {
    const text = `Bonjour ${(current.client || "").split(" ")[0]} 👋, votre commande "${current.produit}" (${Number(current.montant).toLocaleString("fr-FR")} ${currency}) est toujours en attente. Confirmez-vous la livraison ?`;
    window.open(`https://wa.me/${cleanPhoneForWhatsApp(current.tel)}?text=${encodeURIComponent(text)}`, "_blank");
    await onLog(current.id, "Relance groupée envoyée (WhatsApp)");
    setDone((d) => [...d, current.id]);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxWidth: 380, borderRadius: 18, padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 18 }}>Relance groupée</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        {!finished ? (
          <>
            <div style={{ fontSize: 12, color: "#8A9089", marginBottom: 14 }}>
              {index + 1} / {orders.length} — {done.length} déjà contacté{done.length > 1 ? "s" : ""}
            </div>
            <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{current.client}</div>
              <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{current.tel} · {current.produit}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 15, marginTop: 6, color: "#1a7a3c" }}>{Number(current.montant).toLocaleString("fr-FR")} {currency}</div>
            </div>

            <button onClick={sendAndLog} style={{ width: "100%", background: "#1F9D6E", color: "white", border: "none", padding: "11px 0", borderRadius: 10, fontWeight: 600, fontSize: 13.5, cursor: "pointer", marginBottom: 8 }}>
              💬 Envoyer WhatsApp
            </button>
            <button onClick={next} style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "1px solid #DDD8CC", background: "white", color: "#16231F", fontWeight: 600, fontSize: 13.5, cursor: "pointer" }}>
              {index < orders.length - 1 ? "Suivant →" : "Terminer"}
            </button>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{done.length} relance{done.length > 1 ? "s" : ""} envoyée{done.length > 1 ? "s" : ""}</div>
            <div style={{ fontSize: 12.5, color: "#6B7168", marginBottom: 18 }}>sur {orders.length} commandes de la liste</div>
            <button onClick={onClose} style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 10, padding: "10px 24px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              Fermer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ValidationsViewSaas({ commandes, currency }) {
  const [tab, setTab] = useState("validees");
  const [datePreset, setDatePreset] = useState("semaine");
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
    } else if (datePreset === "avanthier") {
      start = new Date(startOfToday.getTime() - 2 * 86400000);
      end = new Date(startOfToday.getTime() - 86400000);
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

  const validationsParJour = useMemo(() => {
    const confirmeesAvecDate = commandes.filter((c) => {
      if (c.statut !== "confirmee" || !c.confirmed_at) return false;
      const d = new Date(c.confirmed_at);
      return d >= dateRange.start && d < dateRange.end;
    });
    const map = {};
    confirmeesAvecDate.forEach((c) => {
      const dValidation = new Date(c.confirmed_at);
      const keyValidation = dValidation.toISOString().slice(0, 10);
      const dCreation = new Date(c.created_at);
      const keyCreation = dCreation.toISOString().slice(0, 10);
      const memeJour = keyValidation === keyCreation;
      if (!map[keyValidation]) map[keyValidation] = { date: keyValidation, label: dValidation.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), orders: [] };
      map[keyValidation].orders.push({ ...c, memeJour, labelCreation: dCreation.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) });
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [commandes, dateRange]);

  const nonValideesParJour = useMemo(() => {
    const nonValidees = commandes.filter((c) => {
      if (c.statut !== "en_cours" && c.statut !== "echouee") return false;
      const d = new Date(c.created_at);
      return d >= dateRange.start && d < dateRange.end;
    });
    const map = {};
    nonValidees.forEach((c) => {
      const d = new Date(c.created_at);
      const key = d.toISOString().slice(0, 10);
      if (!map[key]) map[key] = { date: key, label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), orders: [] };
      map[key].orders.push(c);
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [commandes, dateRange]);

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Validations</div>
      <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 14 }}>
        Ce qui a été confirmé, jour par jour — et ce qui attend encore.
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto" }}>
        {[
          { key: "aujourdhui", label: "Aujourd'hui" },
          { key: "hier", label: "Hier" },
          { key: "avanthier", label: "Avant-hier" },
          { key: "semaine", label: "Cette semaine" },
          { key: "mois", label: "Ce mois" },
          { key: "personnalise", label: "Personnalisé" },
        ].map((d) => (
          <button
            key={d.key}
            onClick={() => setDatePreset(d.key)}
            style={{ padding: "6px 13px", borderRadius: 999, border: `1px solid ${datePreset === d.key ? "#1a7a3c" : "#DDD8CC"}`, background: datePreset === d.key ? "#1a7a3c" : "white", color: datePreset === d.key ? "white" : "#16231F", fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" }}
          >
            {d.label}
          </button>
        ))}
      </div>

      {datePreset === "personnalise" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }} />
          <span style={{ color: "#8A9089", fontSize: 12 }}>à</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }} />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        <button
          onClick={() => setTab("validees")}
          style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${tab === "validees" ? "#1a7a3c" : "#DDD8CC"}`, background: tab === "validees" ? "#1a7a3c" : "white", color: tab === "validees" ? "white" : "#16231F", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          ✅ Validées ({validationsParJour.reduce((s, g) => s + g.orders.length, 0)})
        </button>
        <button
          onClick={() => setTab("nonvalidees")}
          style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${tab === "nonvalidees" ? "#D64933" : "#DDD8CC"}`, background: tab === "nonvalidees" ? "#D64933" : "white", color: tab === "nonvalidees" ? "white" : "#16231F", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          ⏳ Non validées ({nonValideesParJour.reduce((s, g) => s + g.orders.length, 0)})
        </button>
      </div>

      {tab === "validees" && (
        <>
          {validationsParJour.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#8A9089" }}>
              <div style={{ fontSize: 14 }}>Aucune validation enregistrée pour l'instant.</div>
            </div>
          )}
          {validationsParJour.map((group) => (
            <div key={group.date} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a7a3c", textTransform: "capitalize", marginBottom: 8 }}>
                Validé {group.label} ({group.orders.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {group.orders.map((c) => (
                  <div key={c.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{c.client}</div>
                        <div style={{ fontSize: 12, color: "#6B7168" }}>{c.produit}</div>
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 14 }}>{Number(c.montant).toLocaleString("fr-FR")} {currency}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                      {!c.memeJour && (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8A6412", background: "#FBF3E3", padding: "2px 8px", borderRadius: 999 }}>
                          📅 commandée le {c.labelCreation}
                        </span>
                      )}
                      {c.confirmed_by && (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#1a7a3c", background: "#EAF3DE", padding: "2px 8px", borderRadius: 999 }}>
                          ✅ validé par {c.confirmed_by}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      {tab === "nonvalidees" && (
        <>
          {nonValideesParJour.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#8A9089" }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🎉</div>
              <div style={{ fontSize: 14 }}>Tout est validé, rien en attente.</div>
            </div>
          )}
          {nonValideesParJour.map((group) => (
            <div key={group.date} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#D64933", textTransform: "capitalize", marginBottom: 8 }}>
                Commandée {group.label} ({group.orders.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {group.orders.map((c) => (
                  <div key={c.id} style={{ background: "white", border: "1px solid #ECE8DC", borderLeft: `4px solid ${c.statut === "echouee" ? "#D64933" : "#E8A93D"}`, borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{c.client}</div>
                        <div style={{ fontSize: 12, color: "#6B7168" }}>{c.produit} · {c.statut === "echouee" ? "Échouée" : "En cours"}</div>
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 14 }}>{Number(c.montant).toLocaleString("fr-FR")} {currency}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function CelebrationOverlaySaas({ montant, client, currency }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const confettiColors = ["#e8920a", "#1F9D6E", "#1a7a3c", "#f0b94a"];

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, pointerEvents: "none" }}>
      <div
        className={leaving ? "rv-saas-celebrate-out" : "rv-saas-celebrate-in"}
        style={{ background: "#16231F", borderRadius: 20, padding: "28px 36px", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.35)", position: "relative", overflow: "visible" }}
      >
        <div style={{ position: "absolute", top: -6, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
          {confettiColors.map((c, i) => (
            <span key={i} className="rv-saas-confetti" style={{ width: 6, height: 6, borderRadius: i % 2 === 0 ? "50%" : 2, background: c, display: "inline-block", animationDelay: `${i * 0.06}s` }} />
          ))}
        </div>
        <div style={{ fontSize: 32, marginBottom: 6 }}>🎉</div>
        <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12.5, marginBottom: 4 }}>
          Vente récupérée{client ? ` — ${client.split(" ")[0]}` : ""}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 34, color: "#e8920a" }}>
          +{Number(montant).toLocaleString("fr-FR")} {currency}
        </div>
      </div>
    </div>
  );
}

function CarteLivreursSaas({ livreurs }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  const enTourneeAvecPosition = livreurs.filter((l) => l.en_tournee && l.position_lat && l.position_lng);

  useEffect(() => {
    if (!window.L || !mapRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = window.L.map(mapRef.current, { zoomControl: true, attributionControl: true }).setView([5.359952, -4.008256], 12);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(mapInstanceRef.current);
    }

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const icon = window.L.divIcon({
      html: `<div style="background:#1a7a3c;width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
      className: "",
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    enTourneeAvecPosition.forEach((l) => {
      const marker = window.L.marker([l.position_lat, l.position_lng], { icon })
        .addTo(mapInstanceRef.current)
        .bindPopup(`<strong>${l.nom}</strong><br/>En tournée`);
      markersRef.current.push(marker);
    });

    if (enTourneeAvecPosition.length > 0) {
      const bounds = window.L.latLngBounds(enTourneeAvecPosition.map((l) => [l.position_lat, l.position_lng]));
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }

    setTimeout(() => mapInstanceRef.current && mapInstanceRef.current.invalidateSize(), 100);
  }, [JSON.stringify(enTourneeAvecPosition.map((l) => [l.id, l.position_lat, l.position_lng]))]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em" }}>
          Livreurs en tournée en direct
        </div>
        {enTourneeAvecPosition.length > 0 && (
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1F9D6E", display: "inline-block", animation: "rvPulseDot 2s ease-in-out infinite" }} />
        )}
      </div>
      <div ref={mapRef} style={{ width: "100%", height: 220, borderRadius: 12, overflow: "hidden", border: "1px solid #ECE8DC", background: "#EEF0EA" }} />
      {enTourneeAvecPosition.length === 0 && (
        <div style={{ fontSize: 12, color: "#8A9089", marginTop: 6 }}>Aucun livreur en tournée pour le moment.</div>
      )}
    </div>
  );
}
function AideModal({ onClose }) {
  const lienWhatsapp = "https://wa.me/2250509281403";
  const lienGuidePdf = "https://jlrvtwnbtvpurhjdtzly.supabase.co/storage/v1/object/public/boutique/guide-recuvente.pdf";
  const lienQrCode = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(lienWhatsapp)}`;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>❓ Aide</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 20, lineHeight: 1.5 }}>
          Une question, un blocage ? Contacte directement le support, ou consulte le guide complet.
        </div>

        <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 14, padding: 20, marginBottom: 16, textAlign: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "#3B6D11", marginBottom: 14 }}>
            📲 Contacter le support sur WhatsApp
          </div>
          <img
            src={lienQrCode}
            alt="QR Code WhatsApp"
            style={{ width: 160, height: 160, borderRadius: 10, border: "1px solid #C7DDA3", marginBottom: 14 }}
          />
          <div style={{ fontSize: 11.5, color: "#3B6D11", marginBottom: 14 }}>
            Scanne ce code, ou clique sur le bouton ci-dessous
          </div>
          <a
            href={lienWhatsapp}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "block", background: "#1a7a3c", color: "white", border: "none", borderRadius: 10, padding: "13px 0", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
          >
            💬 Ouvrir WhatsApp
          </a>
        </div>

        <a
          href={lienGuidePdf}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", background: "white", border: "1px solid #DDD8CC", color: "#16231F", borderRadius: 10, padding: "13px 0", fontWeight: 600, fontSize: 13.5, textDecoration: "none", boxSizing: "border-box" }}
        >
          📄 Télécharger le guide complet (PDF)
        </a>
        <div style={{ fontSize: 11, color: "#8A9089", marginTop: 8, textAlign: "center" }}>
          Toutes les fonctionnalités expliquées en détail — équipe, comptabilité, boutique.
        </div>
      </div>
    </div>
  );
}

function IntegrationsModal({ workspace, onClose }) {
  const [copie, setCopie] = useState(false);
  const [personnalisation, setPersonnalisation] = useState({
    logo_url: workspace.logo_url || "",
    banniere_url: workspace.banniere_url || "",
    couleur_marque: workspace.couleur_marque || "#1a7a3c",
    description_boutique: workspace.description_boutique || "",
  });
  const [envoiEnCoursType, setEnvoiEnCoursType] = useState(null);
  const [pixelId, setPixelId] = useState(workspace.facebook_pixel_id || "");
  const [savingPixel, setSavingPixel] = useState(false);
  const [pixelSaved, setPixelSaved] = useState(false);

  async function sauvegarderPixel() {
    setSavingPixel(true);
    await supabase.from("workspaces").update({ facebook_pixel_id: pixelId.trim() || null }).eq("id", workspace.id);
    setSavingPixel(false);
    setPixelSaved(true);
    setTimeout(() => setPixelSaved(false), 2000);
  }

  async function envoyerImage(type, fichier) {
    if (!fichier) return;
    if (fichier.size > 5 * 1024 * 1024) {
      alert("L'image est trop lourde (max 5 Mo). Choisis une image plus légère.");
      return;
    }
    setEnvoiEnCoursType(type);
    const extension = fichier.name.split(".").pop();
    const chemin = `${workspace.id}-${type}-${Date.now()}.${extension}`;
    const { error: erreurUpload } = await supabase.storage.from("boutique").upload(chemin, fichier, { upsert: true });
    if (erreurUpload) {
      alert("Erreur lors de l'envoi : " + erreurUpload.message);
      setEnvoiEnCoursType(null);
      return;
    }
    const { data } = supabase.storage.from("boutique").getPublicUrl(chemin);
    const champ = type === "logo" ? "logo_url" : "banniere_url";
    await supabase.from("workspaces").update({ [champ]: data.publicUrl }).eq("id", workspace.id);
    setPersonnalisation((p) => ({ ...p, [champ]: data.publicUrl }));
    setEnvoiEnCoursType(null);
  }

  async function sauvegarderCouleur(couleur) {
    setPersonnalisation((p) => ({ ...p, couleur_marque: couleur }));
    await supabase.from("workspaces").update({ couleur_marque: couleur }).eq("id", workspace.id);
  }

  async function sauvegarderDescription() {
    await supabase.from("workspaces").update({ description_boutique: personnalisation.description_boutique }).eq("id", workspace.id);
  }

  const [copieCommande, setCopieCommande] = useState(false);
  const [copieCatalogue, setCopieCatalogue] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState(workspace.whatsapp_number || "");
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);
  const [whatsappSaved, setWhatsappSaved] = useState(false);
  const webhookUrl = `${window.location.origin}/api/shopify-webhook?secret=${workspace.webhook_secret}`;
  const lienCommande = `${window.location.origin}/?commander=${workspace.id}`;
  const lienCatalogue = `${window.location.origin}/?catalogue=${workspace.id}`;

  function copier() {
    navigator.clipboard.writeText(webhookUrl);
    setCopie(true);
    setTimeout(() => setCopie(false), 2000);
  }

  function copierLienCommande() {
    navigator.clipboard.writeText(lienCommande);
    setCopieCommande(true);
    setTimeout(() => setCopieCommande(false), 2000);
  }

  function copierLienCatalogue() {
    navigator.clipboard.writeText(lienCatalogue);
    setCopieCatalogue(true);
    setTimeout(() => setCopieCatalogue(false), 2000);
  }

  async function sauvegarderWhatsapp() {
    setSavingWhatsapp(true);
    await supabase.from("workspaces").update({ whatsapp_number: whatsappNumber.trim() }).eq("id", workspace.id);
    setSavingWhatsapp(false);
    setWhatsappSaved(true);
    setTimeout(() => setWhatsappSaved(false), 2000);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 440, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>🛍️ Ma Boutique</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        <a
          href={lienCatalogue}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", background: "linear-gradient(135deg, #1a7a3c, #1F9D6E)", color: "white", border: "none", borderRadius: 12, padding: "14px 0", fontWeight: 700, fontSize: 14.5, textDecoration: "none", marginBottom: 20, boxSizing: "border-box" }}
        >
          👁️ Voir ma boutique en ligne
        </a>

        <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "#3B6D11", marginBottom: 4 }}>
            📲 Tu vends via WhatsApp, sans boutique en ligne ?
          </div>
          <div style={{ fontSize: 12.5, color: "#3B6D11", marginBottom: 12, lineHeight: 1.5 }}>
            Partage ce lien à tes clients sur WhatsApp — ils remplissent eux-mêmes leur commande, tu n'as plus rien à taper.
          </div>
          <div style={{ background: "white", border: "1px solid #C7DDA3", borderRadius: 8, padding: "10px 12px", fontSize: 11.5, fontFamily: "monospace", wordBreak: "break-all", marginBottom: 10 }}>
            {lienCommande}
          </div>
          <button
            onClick={copierLienCommande}
            style={{ width: "100%", background: copieCommande ? "#1F9D6E" : "#1a7a3c", color: "white", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
          >
            {copieCommande ? "✅ Copié !" : "📋 Copier mon lien de commande"}
          </button>
        </div>

        <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "#3B6D11", marginBottom: 4 }}>
            🛍️ Ta mini-boutique en ligne
          </div>
          <div style={{ fontSize: 12.5, color: "#3B6D11", marginBottom: 12, lineHeight: 1.5 }}>
            Une page avec tes produits, prix et photos — mets-la en bio Facebook/WhatsApp. Un clic sur un produit ouvre WhatsApp avec un message déjà rempli.
          </div>

          <div style={{ fontSize: 11.5, color: "#3B6D11", marginBottom: 4 }}>Ton numéro WhatsApp (pour recevoir les commandes)</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <input
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="Ex: 07 00 00 00 00"
              style={{ flex: 1, padding: "9px 10px", borderRadius: 8, border: "1px solid #C7DDA3", fontSize: 13 }}
            />
            <button
              onClick={sauvegarderWhatsapp}
              disabled={savingWhatsapp}
              style={{ background: whatsappSaved ? "#1F9D6E" : "#3B6D11", color: "white", border: "none", borderRadius: 8, padding: "0 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
            >
              {whatsappSaved ? "✅" : savingWhatsapp ? "..." : "Enregistrer"}
            </button>
          </div>

          <div style={{ background: "white", border: "1px solid #C7DDA3", borderRadius: 8, padding: "10px 12px", fontSize: 11.5, fontFamily: "monospace", wordBreak: "break-all", marginBottom: 10 }}>
            {lienCatalogue}
          </div>
          <button
            onClick={copierLienCatalogue}
            disabled={!workspace.whatsapp_number && !whatsappSaved}
            style={{ width: "100%", background: copieCatalogue ? "#1F9D6E" : "#1a7a3c", color: "white", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: (!workspace.whatsapp_number && !whatsappSaved) ? 0.5 : 1 }}
          >
            {copieCatalogue ? "✅ Copié !" : "📋 Copier le lien de ma boutique"}
          </button>
          {(!workspace.whatsapp_number && !whatsappSaved) && (
            <div style={{ fontSize: 11, color: "#3B6D11", marginTop: 6 }}>Enregistre ton numéro WhatsApp d'abord ⬆️</div>
          )}
        </div>

        <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "#8A6412", marginBottom: 4 }}>
            🎨 Personnalise ta boutique
          </div>
          <div style={{ fontSize: 12.5, color: "#8A6412", marginBottom: 14, lineHeight: 1.5 }}>
            Logo, bannière et couleur — pour que ta boutique publique te ressemble vraiment.
          </div>

          <div style={{ fontSize: 11.5, color: "#8A6412", marginBottom: 4 }}>Logo</div>
          {personnalisation.logo_url && (
            <img src={personnalisation.logo_url} alt="Logo" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", marginBottom: 8, border: "1px solid #F0DDA8" }} />
          )}
          <label style={{ display: "inline-block", background: "white", border: "1px solid #F0DDA8", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "#8A6412", cursor: "pointer", marginBottom: 14 }}>
            {envoiEnCoursType === "logo" ? "Envoi..." : personnalisation.logo_url ? "Changer le logo" : "Ajouter un logo"}
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => envoyerImage("logo", e.target.files?.[0])} />
          </label>

          <div style={{ fontSize: 11.5, color: "#8A6412", marginBottom: 4 }}>Bannière (image large en haut de la boutique)</div>
          {personnalisation.banniere_url && (
            <img src={personnalisation.banniere_url} alt="Bannière" style={{ width: "100%", height: 70, borderRadius: 10, objectFit: "cover", marginBottom: 8, border: "1px solid #F0DDA8" }} />
          )}
          <label style={{ display: "inline-block", background: "white", border: "1px solid #F0DDA8", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "#8A6412", cursor: "pointer", marginBottom: 14 }}>
            {envoiEnCoursType === "banniere" ? "Envoi..." : personnalisation.banniere_url ? "Changer la bannière" : "Ajouter une bannière"}
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => envoyerImage("banniere", e.target.files?.[0])} />
          </label>

          <div style={{ fontSize: 11.5, color: "#8A6412", marginBottom: 4 }}>Couleur de ta marque</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {["#1a7a3c", "#e8920a", "#D64933", "#2452E8", "#8A2BE2", "#16231F"].map((coul) => (
              <button
                key={coul}
                onClick={() => sauvegarderCouleur(coul)}
                style={{ width: 30, height: 30, borderRadius: "50%", background: coul, border: personnalisation.couleur_marque === coul ? "3px solid #16231F" : "1px solid #DDD8CC", cursor: "pointer" }}
              />
            ))}
          </div>

          <div style={{ fontSize: 11.5, color: "#8A6412", marginBottom: 4 }}>Description courte (optionnel)</div>
          <textarea
            value={personnalisation.description_boutique || ""}
            onChange={(e) => setPersonnalisation({ ...personnalisation, description_boutique: e.target.value })}
            onBlur={sauvegarderDescription}
            placeholder="Ex: Vêtements et accessoires de qualité, livraison rapide à Abidjan"
            rows={2}
            style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #F0DDA8", fontSize: 13, boxSizing: "border-box", fontFamily: "inherit" }}
          />
        </div>

        <div style={{ background: "#EAF0FB", border: "1px solid #C3D4F0", borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "#1E4B8C", marginBottom: 4 }}>
            📊 Pixel Facebook — suis tes publicités
          </div>
          <div style={{ fontSize: 12.5, color: "#1E4B8C", marginBottom: 12, lineHeight: 1.5 }}>
            Colle ton identifiant de Pixel Facebook pour voir combien de ventes viennent réellement de tes publicités.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
              placeholder="Ex: 1761789765001953"
              style={{ flex: 1, padding: "9px 10px", borderRadius: 8, border: "1px solid #C3D4F0", fontSize: 13 }}
            />
            <button
              onClick={sauvegarderPixel}
              disabled={savingPixel}
              style={{ background: pixelSaved ? "#1F9D6E" : "#1E4B8C", color: "white", border: "none", borderRadius: 8, padding: "0 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
            >
              {pixelSaved ? "✅" : savingPixel ? "..." : "Enregistrer"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#1E4B8C", marginTop: 8, opacity: 0.8 }}>
            Trouve-le sur business.facebook.com → Gestionnaire d'événements. Suit automatiquement : visite, vue produit, ajout panier, et achat.
          </div>
        </div>

        <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 16, lineHeight: 1.5 }}>
          Connecte ta boutique Shopify pour que chaque nouvelle commande arrive **automatiquement** ici, sans rien taper à la main.
        </div>

        <div style={{ background: "#FAFAF7", border: "1px solid #ECE8DC", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", marginBottom: 8 }}>Ton lien unique — ne le partage à personne</div>
          <div style={{ background: "white", border: "1px solid #DDD8CC", borderRadius: 8, padding: "10px 12px", fontSize: 11.5, fontFamily: "monospace", wordBreak: "break-all", marginBottom: 10 }}>
            {webhookUrl}
          </div>
          <button
            onClick={copier}
            style={{ width: "100%", background: copie ? "#1F9D6E" : "#1a7a3c", color: "white", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
          >
            {copie ? "✅ Copié !" : "📋 Copier le lien"}
          </button>
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Comment l'installer sur Shopify</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { n: 1, texte: "Sur ta boutique Shopify, va dans Paramètres → Notifications" },
            { n: 2, texte: "Descends jusqu'à \"Webhooks\", clique \"Créer un webhook\"" },
            { n: 3, texte: "Événement : \"Création de commande\" (Order creation)" },
            { n: 4, texte: "Format : JSON" },
            { n: 5, texte: "URL : colle le lien copié ci-dessus" },
            { n: 6, texte: "Enregistre — chaque nouvelle commande Shopify apparaîtra automatiquement dans RecuVente" },
          ].map((etape) => (
            <div key={etape.n} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#EAF3DE", color: "#1a7a3c", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {etape.n}
              </div>
              <div style={{ fontSize: 12.5, color: "#16231F", lineHeight: 1.4 }}>{etape.texte}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 10, padding: "10px 12px", marginTop: 16, fontSize: 12, color: "#8A6412" }}>
          ⚠️ Ce lien est unique à ton entreprise — les commandes créées via ce lien arrivent uniquement dans ton espace, jamais chez une autre entreprise.
        </div>
      </div>
    </div>
  );
}
