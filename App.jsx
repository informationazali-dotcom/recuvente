import React, { useState, useEffect, useMemo, useRef } from "react";
import { Phone, MessageCircle, MessageSquare, Plus, ChevronLeft, X, Check, Users, Truck, Trash2, Package, UserPlus, LogOut, ListChecks, Headset, CheckCheck } from "lucide-react";
import { supabase } from "./supabaseClient";

const STATUS = {
  confirmee: { label: "Confirmée", color: "#1F9D6E", bg: "#EAF7F1" },
  en_cours: { label: "En cours", color: "#E8A93D", bg: "#FBF3E3" },
  echouee: { label: "Échouée", color: "#D64933", bg: "#FBEAE6" },
};

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "";

function formatFCFA(n) {
  return Number(n).toLocaleString("fr-FR").replace(/,/g, " ") + " F";
}

function parseProduitTexte(texte) {
  if (!texte) return { nom: "", quantite: 1 };
  const match = texte.match(/^(.*?)\s*x\s*(\d+)\s*$/i);
  if (match) {
    return { nom: match[1].trim(), quantite: Number(match[2]) || 1 };
  }
  return { nom: texte.trim(), quantite: 1 };
}

function getRangeForPreset(preset) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "aujourdhui") {
    return { start: startOfToday, end: new Date(startOfToday.getTime() + 86400000) };
  }
  if (preset === "hier") {
    return { start: new Date(startOfToday.getTime() - 86400000), end: startOfToday };
  }
  if (preset === "semaine") {
    const day = startOfToday.getDay();
    const diff = day === 0 ? 6 : day - 1;
    return { start: new Date(startOfToday.getTime() - diff * 86400000), end: new Date(now.getTime() + 60000) };
  }
  if (preset === "mois") {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getTime() + 60000) };
  }
  return { start: new Date(0), end: new Date(now.getTime() + 60000) };
}

const COUT_LIVRAISON_CONST = 1500;

function calculerDepotPeriode(orders, livreurs, preset) {
  const { start, end } = getRangeForPreset(preset);
  const ordersP = orders.filter((o) => {
    const d = new Date(o.created_at);
    return d >= start && d < end;
  });
  const confirmees = ordersP.filter((o) => o.statut === "confirmee");
  const montantConfirme = confirmees.reduce((s, o) => s + Number(o.montant), 0);
  const commission = confirmees.length * COUT_LIVRAISON_CONST;
  const aDeposer = montantConfirme - commission;
  return { livraisons: confirmees.length, montantConfirme, commission, aDeposer };
}

function periodLabelFromPreset(preset) {
  const labels = { aujourdhui: "Aujourd'hui", hier: "Hier", semaine: "Cette semaine", mois: "Ce mois", personnalise: "Période personnalisée" };
  return labels[preset] || "";
}

function ResumeMultiPeriodes({ orders, livreurs, dark }) {
  const presets = [
    { key: "aujourdhui", label: "Aujourd'hui" },
    { key: "hier", label: "Hier" },
    { key: "semaine", label: "Cette semaine" },
    { key: "mois", label: "Ce mois" },
  ];
  const lignes = presets.map((p) => ({ ...p, ...calculerDepotPeriode(orders, livreurs, p.key) }));

  return (
    <div style={{ background: dark ? "white" : "white", border: "1px solid #ECE8DC", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 12 }}>
        🏦 Récapitulatif des dépôts — vue d'ensemble
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {lignes.map((l) => (
          <div key={l.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottom: "1px solid #F0EEE6" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{l.label}</div>
              <div style={{ fontSize: 11, color: "#8A9089", marginTop: 1 }}>{l.livraisons} livraison{l.livraisons > 1 ? "s" : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, color: "#3B6D11" }}>{formatFCFA(l.aDeposer)}</div>
              <div style={{ fontSize: 10.5, color: "#8A9089" }}>à déposer</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function exportCSV(orders) {
  const headers = ["Client", "Téléphone", "Produit", "Montant", "Zone", "Statut", "Livreur", "Type", "Frais expédition", "Dépôt reçu", "Date"];
  const rows = orders.map((o) => [
    o.client,
    o.tel,
    o.produit,
    o.montant,
    o.zone || "",
    STATUS[o.statut]?.label || o.statut,
    o.livreur || "",
    o.type_livraison === "expedition" ? "Hors Abidjan" : "Abidjan",
    o.type_livraison === "expedition" ? o.frais_expedition || 0 : "",
    o.type_livraison === "expedition" ? (o.depot_recu ? "Oui" : "Non") : "",
    new Date(o.created_at).toLocaleDateString("fr-FR"),
  ]);
  function neutraliser(valeur) {
    const s = String(valeur ?? "");
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
  }
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${neutraliser(cell).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `recuvente-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function scriptAppel(order) {
  return `Bonjour ${order.client.split(" ")[0]}, je vous appelle au sujet de votre commande "${order.produit}" d'un montant de ${formatFCFA(order.montant)}. Êtes-vous toujours disponible pour la réception ? Nous pouvons livrer dans les prochaines 24h.`;
}

function cleanPhoneForWhatsApp(tel) {
  let digits = String(tel).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("225")) return digits;
  digits = digits.replace(/^0/, "");
  return "225" + digits;
}

function waLink(order) {
  const msg = `Bonjour ${order.client.split(" ")[0]} 👋, nous confirmons votre commande "${order.produit}" (${formatFCFA(order.montant)}). Un livreur passera bientôt. Merci de rester joignable.`;
  return `https://wa.me/${cleanPhoneForWhatsApp(order.tel)}?text=${encodeURIComponent(msg)}`;
}

function smsMsg(order) {
  return `Azali Express: Bonjour ${order.client.split(" ")[0]}, votre commande ${order.produit} (${formatFCFA(order.montant)}) sera livree bientot. Merci de rester joignable. Repondez OK pour confirmer.`;
}

function merciMsg(order) {
  const date = new Date(order.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return `Bonjour ${order.client.split(" ")[0]} 🙏, merci d'avoir commandé chez Azali Express !

🧾 Reçu de votre commande
Produit : ${order.produit}
Montant : ${formatFCFA(order.montant)}
Date : ${date}

Votre colis vous a été livré avec succès ✅

N'hésitez pas à découvrir nos autres produits : https://www.azaliexpress.com

Merci pour votre confiance, à très bientôt ! 💚`;
}

function merciWaLink(order) {
  return `https://wa.me/${cleanPhoneForWhatsApp(order.tel)}?text=${encodeURIComponent(merciMsg(order))}`;
}

function numeroFacture(order) {
  const date = new Date(order.created_at);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const short = order.id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return `AZ-${y}${m}-${short}`;
}

async function genererFacturePDF(order) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const green = [26, 122, 60];
  const orange = [232, 146, 10];
  const gray = [107, 113, 104];
  const dark = [22, 35, 31];

  // En-tête
  doc.setFillColor(...green);
  doc.rect(0, 0, 210, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("AZALI EXPRESS", 15, 18);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Abidjan, Côte d'Ivoire", 15, 25);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("FACTURE", 195, 18, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(numeroFacture(order), 195, 25, { align: "right" });

  // Infos commande / client
  let y = 46;
  doc.setTextColor(...gray);
  doc.setFontSize(9);
  doc.text("FACTURÉ À", 15, y);
  doc.text("DATE", 140, y);

  y += 6;
  doc.setTextColor(...dark);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(order.client || "", 15, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(new Date(order.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), 140, y);

  y += 6;
  doc.setFontSize(10);
  doc.setTextColor(...gray);
  doc.text(order.tel || "", 15, y);
  if (order.zone) {
    y += 5;
    doc.text(order.zone, 15, y, { maxWidth: 90 });
  }

  const estExpedition = order.type_livraison === "expedition" && Number(order.frais_expedition) > 0;
  const totalFacture = Number(order.montant) + (estExpedition ? Number(order.frais_expedition) : 0);

  // Tableau produit
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
  doc.text(order.produit || "", 18, y + 8, { maxWidth: 130 });
  doc.text(formatFCFA(order.montant), 190, y + 8, { align: "right" });
  y += 12;

  if (estExpedition) {
    doc.rect(15, y, 180, 10);
    doc.text("Frais d'expédition (hors Abidjan)", 18, y + 7, { maxWidth: 130 });
    doc.text(formatFCFA(order.frais_expedition), 190, y + 7, { align: "right" });
    y += 10;
  }

  // Total
  y += 8;
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
  doc.text(formatFCFA(totalFacture), 195, y, { align: "right" });

  // Statut paiement
  y += 12;
  const statutPaiement = order.statut === "confirmee" ? "PAYÉE (à la livraison)" : "EN ATTENTE DE PAIEMENT";
  const couleurStatut = order.statut === "confirmee" ? green : orange;
  doc.setFillColor(...couleurStatut);
  doc.roundedRect(15, y, 75, 9, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(statutPaiement, 52.5, y + 6, { align: "center" });

  // Pied de page
  doc.setTextColor(...gray);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Merci pour votre confiance — Azali Express", 105, 280, { align: "center" });
  doc.text("Paiement à la livraison (COD) — Facture générée automatiquement", 105, 285, { align: "center" });

  const nomFichier = `Facture-${numeroFacture(order)}.pdf`;
  const blob = doc.output("blob");
  const fichier = new File([blob], nomFichier, { type: "application/pdf" });

  if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
    navigator.share({
      files: [fichier],
      title: nomFichier,
      text: `Voici votre facture Azali Express — ${order.produit}`,
    }).catch(() => {
      doc.save(nomFichier);
    });
  } else {
    doc.save(nomFichier);
  }
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [orders, setOrders] = useState([]);
  const [livreurs, setLivreurs] = useState([]);
  const [closers, setClosers] = useState([]);
  const [comptables, setComptables] = useState([]);
  const [catalogueProduits, setCatalogueProduits] = useState([]);
  const [view, setView] = useState("dashboard");
  const [filter, setFilter] = useState("toutes");
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddLivreur, setShowAddLivreur] = useState(false);
  const [showAddCloser, setShowAddCloser] = useState(false);
  const [showAddComptable, setShowAddComptable] = useState(false);
  const [showComptables, setShowComptables] = useState(false);
  const [showComptaDetail, setShowComptaDetail] = useState(false);
  const [showProduits, setShowProduits] = useState(false);
  const [showAddProduit, setShowAddProduit] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [showCampagne, setShowCampagne] = useState(false);
  const [celebration, setCelebration] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [livreursLoaded, setLivreursLoaded] = useState(false);
  const [closersLoaded, setClosersLoaded] = useState(false);
  const [comptablesLoaded, setComptablesLoaded] = useState(false);
  const [produitsLoaded, setProduitsLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [datePreset, setDatePreset] = useState("aujourdhui");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));

    async function handleVisible() {
      if (document.visibilityState === "visible") {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session) {
          setSession(data.session);
          loadOrders();
          loadLivreurs();
        }
      }
    }
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);

    return () => {
      listener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
    };
  }, []);

  const knownOrderIds = useRef(null);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  const VAPID_PUBLIC_KEY = "BPvSwnx9c3S8a78HAXZRGgmUw859riej4B2ESkap1Ab40DP0VsYRjTLLqmZ1TTEkmHmfw5A4VjZcjmepewO0OsI";

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
        showToast("Notifications Push non supportées sur ce navigateur");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      }

      const raw = subscription.toJSON();
      await supabase.from("push_subscriptions").upsert(
        [{ email: session.user.email, endpoint: raw.endpoint, p256dh: raw.keys.p256dh, auth: raw.keys.auth }],
        { onConflict: "endpoint" }
      );
      showToast("🔔 Notifications activées, même app fermée !");
    } catch (e) {
      showToast("Erreur activation notifications: " + e.message);
    }
  }

  function playNotifSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();

      function jouerChaChing(decalage) {
        const notes = [
          { freq: 987.77, start: decalage, dur: 0.16, vol: 0.55 },       // Si
          { freq: 1318.51, start: decalage + 0.1, dur: 0.32, vol: 0.6 },  // Mi (aigu)
          { freq: 1975.53, start: decalage + 0.1, dur: 0.32, vol: 0.25 }, // Si aigu (harmonique, donne du corps)
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
      jouerChaChing(0.55); // 2e passage pour être sûr d'être entendu
    } catch (e) {}
  }

  function playCelebrationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99]; // Do-Mi-Sol, accord satisfaisant
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

  function notifyNewOrder(order) {
    playNotifSound();
    showToast(`🔔 Nouvelle commande — ${order.client}`);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Nouvelle commande RecuVente", {
          body: `${order.client} — ${order.produit} (${formatFCFA(order.montant)})`,
          icon: "/icon-192.png",
        });
      } catch (e) {}
    }
  }

  async function loadOrders(isRetry) {
    const { data, error } = await supabase
      .from("commandes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      if (!isRetry && (error.message || "").toLowerCase().includes("jwt")) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed.session) return loadOrders(true);
      }
      setError(error.message);
    } else {
      const list = data || [];
      if (knownOrderIds.current !== null) {
        const nouvelles = list.filter((o) => !knownOrderIds.current.has(o.id));
        nouvelles.forEach((o) => notifyNewOrder(o));
      }
      knownOrderIds.current = new Set(list.map((o) => o.id));
      setOrders(list);
      setError(null);
    }
    setOrdersLoaded(true);
  }

  async function loadLivreurs() {
    const { data, error } = await supabase
      .from("livreurs")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setLivreurs(data || []);
    setLivreursLoaded(true);
  }

  async function loadClosers() {
    const { data, error } = await supabase
      .from("closers")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setClosers(data || []);
    setClosersLoaded(true);
  }

  async function loadComptables() {
    const { data, error } = await supabase
      .from("comptables")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setComptables(data || []);
    setComptablesLoaded(true);
  }

  async function loadProduits() {
    const { data, error } = await supabase
      .from("produits")
      .select("*")
      .order("nom", { ascending: true });
    if (!error) setCatalogueProduits(data || []);
    setProduitsLoaded(true);
  }

  const [allRelances, setAllRelances] = useState([]);

  async function loadRelances() {
    const { data, error } = await supabase
      .from("relances")
      .select("commande_id, created_at")
      .order("created_at", { ascending: false });
    if (!error) setAllRelances(data || []);
  }

  useEffect(() => {
    loadOrders();
    loadLivreurs();
    loadClosers();
    loadComptables();
    loadProduits();
    loadRelances();
    const interval = setInterval(() => {
      loadOrders();
      loadLivreurs();
      loadClosers();
      loadComptables();
      loadProduits();
      loadRelances();
    }, 15000);

    // Détection instantanée des nouvelles commandes (Shopify inclus), sans attendre le prochain cycle de 15s
    const channel = supabase
      .channel("commandes-temps-reel")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "commandes" }, () => {
        loadOrders();
      })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const loaded = ordersLoaded && livreursLoaded && closersLoaded && comptablesLoaded && produitsLoaded;

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

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

  const previousRange = useMemo(() => {
    const duration = dateRange.end.getTime() - dateRange.start.getTime();
    return { start: new Date(dateRange.start.getTime() - duration), end: dateRange.start };
  }, [dateRange]);

  const ordersInRange = useMemo(() => {
    return orders.filter((o) => {
      const d = new Date(o.created_at);
      return d >= dateRange.start && d < dateRange.end;
    });
  }, [orders, dateRange]);

  const ordersPreviousRange = useMemo(() => {
    return orders.filter((o) => {
      const d = new Date(o.created_at);
      return d >= previousRange.start && d < previousRange.end;
    });
  }, [orders, previousRange]);

  const chiffreAffairesPrecedent = useMemo(
    () => ordersPreviousRange.reduce((sum, o) => sum + Number(o.montant), 0),
    [ordersPreviousRange]
  );

  const COUT_LIVRAISON = 1500;

  function trouverCoutProduit(texteProduit) {
    const { nom, quantite } = parseProduitTexte(texteProduit);
    const trouve = catalogueProduits.find((p) => p.nom.toLowerCase() === nom.toLowerCase());
    if (!trouve) return null;
    return trouve.cout_achat * quantite;
  }

  const stats = useMemo(() => {
    const confirmees = ordersInRange.filter((o) => o.statut === "confirmee");
    const echouees = ordersInRange.filter((o) => o.statut === "echouee");
    const enCours = ordersInRange.filter((o) => o.statut === "en_cours");
    const recupere = ordersInRange.reduce((sum, o) => sum + (o.recupere ? Number(o.montant) + Number(o.frais_expedition || 0) : 0), 0);
    const chiffreAffaires = ordersInRange.reduce((sum, o) => sum + Number(o.montant) + Number(o.frais_expedition || 0), 0);
    const tauxLivraison = ordersInRange.length ? Math.round((confirmees.length / ordersInRange.length) * 100) : 0;
    const tauxEchec = ordersInRange.length ? Math.round((echouees.length / ordersInRange.length) * 100) : 0;
    const coutLivraisons = confirmees.length * COUT_LIVRAISON;
    const montantConfirme = confirmees.reduce((sum, o) => sum + Number(o.montant) + Number(o.frais_expedition || 0), 0);

    let coutProduitsTotal = 0;
    let nbCoutInconnu = 0;
    let montantCoutInconnu = 0;
    confirmees.forEach((o) => {
      const cout = trouverCoutProduit(o.produit);
      if (cout === null) {
        nbCoutInconnu += 1;
        montantCoutInconnu += Number(o.montant);
      } else {
        coutProduitsTotal += cout;
      }
    });

    const beneficeReel = montantConfirme - coutLivraisons - coutProduitsTotal;

    return {
      recupere,
      chiffreAffaires,
      aRisque: echouees.length + enCours.length,
      tauxLivraison,
      tauxEchec,
      total: ordersInRange.length,
      livrees: confirmees.length,
      enAttente: enCours.length,
      echouees: echouees.length,
      coutLivraisons,
      coutProduitsTotal,
      nbCoutInconnu,
      montantCoutInconnu,
      beneficeReel,
    };
  }, [ordersInRange, catalogueProduits]);

  const evolutionCA = useMemo(() => {
    if (chiffreAffairesPrecedent === 0) return null;
    return Math.round(((stats.chiffreAffaires - chiffreAffairesPrecedent) / chiffreAffairesPrecedent) * 100);
  }, [stats.chiffreAffaires, chiffreAffairesPrecedent]);

  const [searchQuery, setSearchQuery] = useState("");

  const clientsSuspects = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      const key = o.tel;
      if (!key) return;
      if (!map[key]) map[key] = { tel: key, nom: o.client, echouees: 0, total: 0 };
      map[key].total += 1;
      if (o.statut === "echouee") map[key].echouees += 1;
    });
    return Object.values(map).filter((c) => c.echouees >= 3);
  }, [orders]);

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

    const actives = orders.filter((o) => o.statut === "en_cours" || o.statut === "echouee");

    const byMontant = (a, b) => Number(b.montant) - Number(a.montant);

    const aRelivrer = actives.filter((o) => o.date_relivraison === todayStr).sort(byMontant);

    const jamaisContactees = actives
      .filter((o) => !relanceCountByOrder.count[o.id] && aRelivrer.every((a) => a.id !== o.id))
      .sort(byMontant);

    const sansNouvelles = actives
      .filter((o) => {
        if (aRelivrer.some((a) => a.id === o.id)) return false;
        if (jamaisContactees.some((j) => j.id === o.id)) return false;
        const last = relanceCountByOrder.last[o.id];
        if (!last) return false;
        return new Date(last) < now24hAgo;
      })
      .sort(byMontant);

    const total = aRelivrer.length + jamaisContactees.length + sansNouvelles.length;
    const montantTotal = [...aRelivrer, ...jamaisContactees, ...sansNouvelles].reduce((s, o) => s + Number(o.montant), 0);

    const echouees = orders.filter((o) => o.statut === "echouee");
    const enCoursOrEchouee = orders.filter((o) => o.statut === "en_cours" || o.statut === "echouee");
    const argentARisque = enCoursOrEchouee.reduce((s, o) => s + Number(o.montant), 0);
    const argentRecuperable = echouees.reduce((s, o) => s + Number(o.montant), 0);

    return {
      aRelivrer,
      jamaisContactees,
      sansNouvelles,
      total,
      montantTotal,
      argentARisque,
      argentRecuperable,
    };
  }, [orders, relanceCountByOrder]);

  const [filterLivreur, setFilterLivreur] = useState("tous");
  const [filterProduit, setFilterProduit] = useState("tous");

  const filtered = useMemo(() => {
    let r = filter === "toutes" ? ordersInRange : ordersInRange.filter((o) => o.statut === filter);
    if (filterLivreur !== "tous") r = r.filter((o) => o.livreur === filterLivreur);
    if (filterProduit !== "tous") r = r.filter((o) => (o.produit || "").split(" x")[0].trim() === filterProduit);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      r = r.filter((o) => (o.client || "").toLowerCase().includes(q) || (o.tel || "").includes(q));
    }
    return r;
  }, [ordersInRange, filter, filterLivreur, filterProduit, searchQuery]);

  const evolution = useMemo(() => {
    const map = {};
    ordersInRange.forEach((o) => {
      const d = new Date(o.created_at);
      const key = d.toISOString().slice(0, 10);
      if (!map[key]) map[key] = { date: key, commandes: 0, revenus: 0, label: d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) };
      map[key].commandes += 1;
      map[key].revenus += Number(o.montant);
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [ordersInRange]);

  const groupedByDay = useMemo(() => {
    const groups = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    filtered.forEach((o) => {
      const d = new Date(o.created_at);
      const dayKey = d.toISOString().slice(0, 10);
      if (!groups[dayKey]) {
        const label = d.toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
        groups[dayKey] = { label, orders: [] };
      }
      groups[dayKey].orders.push(o);
    });

    return Object.entries(groups)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, val]) => val);
  }, [filtered]);

  async function updateStatus(id, statut) {
    const current = orders.find((o) => o.id === id);
    if (statut === "confirmee" && current?.type_livraison === "expedition" && !current?.depot_recu) {
      showToast("⛔ Impossible de confirmer : le dépôt n'a pas encore été reçu");
      return;
    }
    const vraimentRecuperee = statut === "confirmee" && current?.statut === "echouee";
    const recupere = vraimentRecuperee ? true : current?.recupere;
    const nomValidateur = monProfilLivreur?.nom || monProfilCloser?.nom || "Admin";
    const infosValidation = statut === "confirmee" ? { confirmed_at: new Date().toISOString(), confirmed_by: nomValidateur } : {};
    const { error } = await supabase.from("commandes").update({ statut, recupere, ...infosValidation }).eq("id", id);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadOrders();
    if (selected && selected.id === id) setSelected((s) => ({ ...s, statut, ...infosValidation }));
    if (current && current.statut !== statut) {
      logEvent(id, `📋 Statut : ${STATUS[current.statut]?.label || current.statut} → ${STATUS[statut]?.label || statut}${statut === "confirmee" ? ` par ${nomValidateur}` : ""}`);
    }
    if (vraimentRecuperee && current) {
      setCelebration({ montant: current.montant, client: current.client });
      playCelebrationSound();
      setTimeout(() => setCelebration(null), 2600);
    } else {
      showToast("Statut mis à jour");
    }
  }

  async function addOrder(order) {
    const { error } = await supabase.from("commandes").insert([
      { ...order, montant: Number(order.montant), frais_expedition: Number(order.frais_expedition) || 0, montant_depot: Number(order.montant_depot) || 0, depot_recu_le: order.depot_recu ? new Date().toISOString() : null, recupere: false },
    ]);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadOrders();
    setShowAdd(false);
    showToast("Commande ajoutée");
  }

  async function addLivreur(livreur) {
    const { error } = await supabase.from("livreurs").insert([livreur]);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadLivreurs();
    setShowAddLivreur(false);
    showToast("Livreur ajouté");
  }

  async function deleteLivreur(id) {
    const { error } = await supabase.from("livreurs").delete().eq("id", id);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadLivreurs();
    showToast("Livreur retiré");
  }

  async function assignLivreur(orderId, livreurNom) {
    const { error } = await supabase.from("commandes").update({ livreur: livreurNom }).eq("id", orderId);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadOrders();
    if (selected && selected.id === orderId) setSelected((s) => ({ ...s, livreur: livreurNom }));
    logEvent(orderId, livreurNom ? `🚚 Livreur assigné : ${livreurNom}` : "🚚 Livreur retiré");
  }

  async function addCloser(closer) {
    const { error } = await supabase.from("closers").insert([closer]);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadClosers();
    setShowAddCloser(false);
    showToast("Closer ajouté");
  }

  async function deleteCloser(id) {
    const { error } = await supabase.from("closers").delete().eq("id", id);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadClosers();
    showToast("Closer retiré");
  }

  async function addComptable(comptable) {
    const { error } = await supabase.from("comptables").insert([comptable]);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadComptables();
    setShowAddComptable(false);
    showToast("Comptable ajouté");
  }

  async function deleteComptable(id) {
    const { error } = await supabase.from("comptables").delete().eq("id", id);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadComptables();
    showToast("Comptable retiré");
  }

  async function addProduit(produit) {
    const { error } = await supabase.from("produits").insert([{ nom: produit.nom, cout_achat: Number(produit.cout_achat) }]);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadProduits();
    setShowAddProduit(false);
    showToast("Produit ajouté");
  }

  async function updateProduitCout(id, cout_achat) {
    const { error } = await supabase.from("produits").update({ cout_achat: Number(cout_achat) }).eq("id", id);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadProduits();
  }

  async function updateProduitStock(id, stock_initial) {
    const { error } = await supabase.from("produits").update({ stock_initial: Number(stock_initial) }).eq("id", id);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadProduits();
  }

  async function deleteProduit(id) {
    const { error } = await supabase.from("produits").delete().eq("id", id);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadProduits();
    showToast("Produit retiré du catalogue");
  }

  async function assignCloser(orderId, closerNom) {
    const { error } = await supabase.from("commandes").update({ closer: closerNom }).eq("id", orderId);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadOrders();
    if (selected && selected.id === orderId) setSelected((s) => ({ ...s, closer: closerNom }));
    logEvent(orderId, closerNom ? `🎧 Closer assigné : ${closerNom}` : "🎧 Closer retiré");
  }

  async function seAttribuerCommande(orderId, closerNom) {
    // Mise à jour conditionnelle : ne fonctionne QUE si personne ne l'a déjà prise entre-temps
    const { data, error } = await supabase
      .from("commandes")
      .update({ closer: closerNom })
      .eq("id", orderId)
      .is("closer", null)
      .select();

    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    if (!data || data.length === 0) {
      showToast("⚠️ Trop tard, un autre closer vient de la prendre");
      await loadOrders();
      return;
    }
    logEvent(orderId, `🎧 Prise en charge par ${closerNom}`);
    await loadOrders();
    showToast("✅ Commande attribuée, à toi de jouer !");
  }

  async function rescheduleOrder(orderId, date) {
    const { error } = await supabase.from("commandes").update({ date_relivraison: date || null }).eq("id", orderId);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadOrders();
    if (selected && selected.id === orderId) setSelected((s) => ({ ...s, date_relivraison: date }));
    if (date) {
      logEvent(orderId, `📅 Livraison reprogrammée au ${new Date(date + "T00:00:00").toLocaleDateString("fr-FR")}`);
    }
    showToast("Date de livraison mise à jour");
  }

  async function updateOrderInfos(orderId, infos) {
    const { error } = await supabase.from("commandes").update(infos).eq("id", orderId);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadOrders();
    if (selected && selected.id === orderId) setSelected((s) => ({ ...s, ...infos }));
    logEvent(orderId, `✏️ Informations modifiées`);
    showToast("Commande mise à jour");
  }

  async function marquerDepot(orderId, montant) {
    const infos = { depot_recu: true, montant_depot: montant, depot_recu_le: new Date().toISOString() };
    const { error } = await supabase.from("commandes").update(infos).eq("id", orderId);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadOrders();
    if (selected && selected.id === orderId) setSelected((s) => ({ ...s, ...infos }));
    logEvent(orderId, `💰 Dépôt reçu : ${montant.toLocaleString("fr-FR")} FCFA`);
    showToast("Dépôt enregistré");
  }

  async function logEvent(orderId, note) {
    await supabase.from("relances").insert([{ commande_id: orderId, note }]);
    loadRelances();
  }

  async function logRelance(orderId, note) {
    await supabase.from("relances").insert([{ commande_id: orderId, note }]);
    await loadRelances();
  }

  const livreursStats = useMemo(() => {
    const stats = livreurs.map((l) => {
      const mesCommandes = ordersInRange.filter((o) => o.livreur === l.nom);
      const livrees = mesCommandes.filter((o) => o.statut === "confirmee");
      const echouees = mesCommandes.filter((o) => o.statut === "echouee");
      const total = mesCommandes.length;
      const taux = total ? Math.round((livrees.length / total) * 100) : null;
      const montantRecupere = livrees.reduce((s, o) => s + Number(o.montant), 0);
      const montantPerdu = echouees.reduce((s, o) => s + Number(o.montant), 0);
      const montantDu = livrees.length * 1500;
      const montantADeposer = montantRecupere - montantDu;

      const detailProduits = {};
      mesCommandes.forEach((o) => {
        const { nom, quantite } = parseProduitTexte(o.produit);
        if (!nom) return;
        if (!detailProduits[nom]) detailProduits[nom] = { nom, assignes: 0, livres: 0, restants: 0 };
        detailProduits[nom].assignes += quantite;
        if (o.statut === "confirmee") {
          detailProduits[nom].livres += quantite;
        } else {
          detailProduits[nom].restants += quantite;
        }
      });
      const produitsDetail = Object.values(detailProduits).sort((a, b) => b.assignes - a.assignes);

      return { ...l, total, livrees: livrees.length, echouees: echouees.length, taux, montantRecupere, montantPerdu, montantDu, montantADeposer, produitsDetail };
    });
    return stats.sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1));
  }, [livreurs, ordersInRange]);

  const closersStats = useMemo(() => {
    const stats = closers.map((c) => {
      const mesCommandes = ordersInRange.filter((o) => o.closer === c.nom);
      const confirmees = mesCommandes.filter((o) => o.statut === "confirmee");
      const echouees = mesCommandes.filter((o) => o.statut === "echouee");
      const enCours = mesCommandes.filter((o) => o.statut === "en_cours");
      const total = mesCommandes.length;
      const taux = total ? Math.round((confirmees.length / total) * 100) : null;
      const montantRecupere = confirmees.reduce((s, o) => s + Number(o.montant), 0);

      const detailProduits = {};
      mesCommandes.forEach((o) => {
        const { nom, quantite } = parseProduitTexte(o.produit);
        if (!nom) return;
        if (!detailProduits[nom]) detailProduits[nom] = { nom, assignes: 0, livres: 0, restants: 0 };
        detailProduits[nom].assignes += quantite;
        if (o.statut === "confirmee") {
          detailProduits[nom].livres += quantite;
        } else {
          detailProduits[nom].restants += quantite;
        }
      });
      const produitsDetail = Object.values(detailProduits).sort((a, b) => b.assignes - a.assignes);

      return { ...c, total, confirmees: confirmees.length, echouees: echouees.length, enCours: enCours.length, taux, montantRecupere, produitsDetail };
    });
    return stats.sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1));
  }, [closers, ordersInRange]);

  const commandesNonAssignees = useMemo(() => orders.filter((o) => !o.closer && (o.statut === "en_cours" || o.statut === "echouee")).length, [orders]);

  const repartitionCloserLivreur = useMemo(() => {
    const map = {};
    ordersInRange.forEach((o) => {
      if (!o.closer || !o.livreur) return;
      const key = o.closer + "|||" + o.livreur;
      if (!map[key]) map[key] = { closer: o.closer, livreur: o.livreur, total: 0, produits: {} };
      map[key].total += 1;
      const { nom, quantite } = parseProduitTexte(o.produit);
      if (nom) map[key].produits[nom] = (map[key].produits[nom] || 0) + quantite;
    });
    return Object.values(map)
      .map((r) => ({ ...r, produitsListe: Object.entries(r.produits).map(([nom, qte]) => ({ nom, qte })).sort((a, b) => b.qte - a.qte) }))
      .sort((a, b) => b.total - a.total);
  }, [ordersInRange]);

  const periodLabel = useMemo(() => {
    const labels = { aujourdhui: "Aujourd'hui", hier: "Hier", semaine: "Cette semaine", mois: "Ce mois", personnalise: "Période personnalisée" };
    return labels[datePreset] || "";
  }, [datePreset]);

  const clients = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      const key = o.tel || o.client;
      if (!map[key]) {
        map[key] = { nom: o.client, tel: o.tel, zone: o.zone, commandes: [] };
      }
      map[key].commandes.push(o);
    });
    return Object.values(map)
      .map((c) => {
        const produitCount = {};
        c.commandes.forEach((o) => {
          const p = (o.produit || "").split(" x")[0].trim();
          if (p) produitCount[p] = (produitCount[p] || 0) + 1;
        });
        const produitPrefere = Object.entries(produitCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

        const confirmeesTriees = c.commandes
          .filter((o) => o.statut === "confirmee")
          .map((o) => new Date(o.created_at))
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
          ...c,
          total: c.commandes.length,
          confirmees: c.commandes.filter((o) => o.statut === "confirmee").length,
          echouees: c.commandes.filter((o) => o.statut === "echouee").length,
          montantTotal: c.commandes.reduce((s, o) => s + (o.recupere ? Number(o.montant) : 0), 0),
          produitPrefere,
          intervalleMoyen,
          joursDepuisDernier,
          joursDeRetard,
        };
      })
      .sort((a, b) => b.montantTotal - a.montantTotal);
  }, [orders]);

  const clientsARelancer = useMemo(() => {
    return clients
      .filter((c) => c.joursDeRetard !== null && c.joursDeRetard >= 0)
      .sort((a, b) => b.joursDeRetard - a.joursDeRetard);
  }, [clients]);

  const produits = useMemo(() => {
    const map = {};
    ordersInRange.forEach((o) => {
      const nomProduit = (o.produit || "Autre").split(" x")[0].trim();
      if (!map[nomProduit]) map[nomProduit] = { nom: nomProduit, ventes: 0, revenus: 0, livrees: 0 };
      map[nomProduit].ventes += 1;
      map[nomProduit].revenus += Number(o.montant);
      if (o.statut === "confirmee") map[nomProduit].livrees += 1;
    });
    return Object.values(map).sort((a, b) => b.ventes - a.ventes);
  }, [ordersInRange]);

  const produitsQuantiteDetail = useMemo(() => {
    const map = {};
    ordersInRange.forEach((o) => {
      const { nom, quantite } = parseProduitTexte(o.produit);
      if (!nom) return;
      if (!map[nom]) map[nom] = { nom, assignes: 0, livres: 0, restants: 0 };
      map[nom].assignes += quantite;
      if (o.statut === "confirmee") map[nom].livres += quantite;
      else map[nom].restants += quantite;
    });
    return Object.values(map).sort((a, b) => b.assignes - a.assignes);
  }, [ordersInRange]);

  const meilleurProduit = produits[0] || null;
  const produitPlusRentable = produits.length ? [...produits].sort((a, b) => b.revenus - a.revenus)[0] : null;
  const meilleurLivreur = livreursStats.length ? [...livreursStats].sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1))[0] : null;

  const quantitesParProduit = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      const { nom, quantite } = parseProduitTexte(o.produit);
      if (!nom) return;
      if (!map[nom]) map[nom] = { commandees: 0, livrees: 0 };
      if (o.statut !== "echouee") map[nom].commandees += quantite; // en_cours + confirmée = potentiellement engagé sur le stock
      if (o.statut === "confirmee") map[nom].livrees += quantite;
    });
    return map;
  }, [orders]);

  const anomaliesProduitZone = useMemo(() => {
    const traites = orders.filter((o) => o.statut === "confirmee" || o.statut === "echouee");

    const globalParProduit = {};
    traites.forEach((o) => {
      const p = (o.produit || "").split(" x")[0].trim();
      if (!p) return;
      if (!globalParProduit[p]) globalParProduit[p] = { total: 0, echecs: 0 };
      globalParProduit[p].total += 1;
      if (o.statut === "echouee") globalParProduit[p].echecs += 1;
    });

    const parProduitZone = {};
    traites.forEach((o) => {
      const p = (o.produit || "").split(" x")[0].trim();
      const z = (o.zone || "").trim();
      if (!p || !z) return;
      const key = p + "|||" + z;
      if (!parProduitZone[key]) parProduitZone[key] = { produit: p, zone: z, total: 0, echecs: 0 };
      parProduitZone[key].total += 1;
      if (o.statut === "echouee") parProduitZone[key].echecs += 1;
    });

    const anomalies = [];
    Object.values(parProduitZone).forEach((g) => {
      if (g.total < 5) return; // échantillon trop petit, pas fiable
      const tauxLocal = g.echecs / g.total;
      const global = globalParProduit[g.produit];
      const tauxGlobal = global && global.total > 0 ? global.echecs / global.total : 0;
      const ecartPoints = (tauxLocal - tauxGlobal) * 100;
      if (ecartPoints >= 15 && tauxLocal >= tauxGlobal * 1.5) {
        anomalies.push({
          produit: g.produit,
          zone: g.zone,
          total: g.total,
          tauxLocal: Math.round(tauxLocal * 100),
          tauxGlobal: Math.round(tauxGlobal * 100),
        });
      }
    });

    return anomalies.sort((a, b) => b.tauxLocal - a.tauxLocal);
  }, [orders]);

  if (session === undefined) {
    return (
      <div style={{ background: "#FAFAF7", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Sans', sans-serif" }}>
        Chargement…
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (!loaded) {
    return (
      <div style={{ background: "#FAFAF7", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Sans', sans-serif" }}>
        Chargement…
      </div>
    );
  }

  const monProfilLivreur = livreurs.find((l) => l.email && l.email.toLowerCase() === session.user.email.toLowerCase());

  if (monProfilLivreur && !error) {
    return (
      <LivreurPortal
        livreur={monProfilLivreur}
        orders={orders.filter((o) => o.livreur === monProfilLivreur.nom)}
        onStatus={updateStatus}
        toast={toast}
      />
    );
  }

  const monProfilCloser = closers.find((c) => c.email && c.email.toLowerCase() === session.user.email.toLowerCase());

  const monProfilComptable = comptables.find((c) => c.email && c.email.toLowerCase() === session.user.email.toLowerCase());

  if (monProfilComptable && !error) {
    return (
      <ComptablePortal
        comptable={monProfilComptable}
        orders={orders}
        livreurs={livreurs}
      />
    );
  }

  if (error) {
    return (
      <div style={{ background: "#FAFAF7", minHeight: "100vh", padding: 24, fontFamily: "'IBM Plex Sans', sans-serif" }}>
        <div style={{ background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 12, padding: 16, color: "#D64933" }}>
          <strong>Connexion à la base de données impossible.</strong>
          <div style={{ fontSize: 13, marginTop: 6 }}>{error}</div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button
            onClick={async () => {
              const { data } = await supabase.auth.refreshSession();
              if (data.session) { setSession(data.session); loadOrders(); loadLivreurs(); }
            }}
            style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", background: "#1a7a3c", color: "white", fontWeight: 600, fontSize: 14 }}
          >
            Réessayer
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "1px solid #DDD8CC", background: "white", color: "#16231F", fontWeight: 600, fontSize: 14 }}
          >
            Se reconnecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-app" style={{ background: "#FAFAF7", minHeight: "100vh", fontFamily: "'IBM Plex Sans', sans-serif", color: "#16231F", paddingBottom: 76 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        * { box-sizing: border-box; }
        .rv-app { width: 100%; position: relative; }
        button { font-family: inherit; cursor: pointer; transition: transform 0.12s ease, opacity 0.12s ease, background 0.15s ease, border-color 0.15s ease; }
        button:active { transform: scale(0.97); }
        .rv-sidebar button, .rv-bottomnav button { transition: background 0.18s ease, color 0.18s ease; }
        .rv-fadein { animation: rvFadeIn 0.28s ease; }
        @keyframes rvFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .rv-card-anim { animation: rvFadeIn 0.22s ease backwards; }
        .rv-modal-sheet { animation: rvSlideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes rvSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .rv-modal-backdrop { animation: rvFadeIn 0.18s ease; }
        .rv-celebrate-in { animation: rvCelebrateIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes rvCelebrateIn {
          0% { opacity: 0; transform: scale(0.5) translateY(20px); }
          60% { opacity: 1; transform: scale(1.08) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .rv-celebrate-out { animation: rvCelebrateOut 0.35s ease forwards; }
        @keyframes rvCelebrateOut {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.92) translateY(-10px); }
        }
        .rv-confetti { animation: rvConfetti 1.4s ease-out forwards; }
        @keyframes rvConfetti {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(90px) rotate(360deg); opacity: 0; }
        }
        .rv-livedot { animation: rvPulseDot 2s ease-in-out infinite; }
        @keyframes rvPulseDot {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(127,214,163,0.5); }
          50% { opacity: 0.5; box-shadow: 0 0 0 4px rgba(127,214,163,0); }
        }
        .rv-glow { animation: rvGlowBreathe 4s ease-in-out infinite; }
        @keyframes rvGlowBreathe {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.15); }
        }
        .rv-mesh-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(40px);
          pointer-events: none;
        }
        .rv-mesh-1 {
          width: 180px; height: 180px;
          background: radial-gradient(circle, rgba(232,146,10,0.45) 0%, rgba(232,146,10,0) 70%);
          top: -60px; right: -40px;
          animation: rvMeshFloat1 9s ease-in-out infinite;
        }
        .rv-mesh-2 {
          width: 140px; height: 140px;
          background: radial-gradient(circle, rgba(127,214,163,0.4) 0%, rgba(127,214,163,0) 70%);
          bottom: -50px; left: 10%;
          animation: rvMeshFloat2 11s ease-in-out infinite;
        }
        .rv-mesh-3 {
          width: 110px; height: 110px;
          background: radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%);
          top: 20%; right: 25%;
          animation: rvMeshFloat3 7s ease-in-out infinite;
        }
        @keyframes rvMeshFloat1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-20px, 20px) scale(1.15); }
        }
        @keyframes rvMeshFloat2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(25px, -15px) scale(1.1); }
        }
        @keyframes rvMeshFloat3 {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.6; }
          50% { transform: translate(-15px, -10px) scale(1.3); opacity: 1; }
        }
        .rv-glass-card {
          position: relative;
          overflow: hidden;
          border-radius: 12px;
          padding: 11px 13px;
          background: linear-gradient(155deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0.1) 100%);
          border: 1px solid rgba(255,255,255,0.25);
          box-shadow: 0 4px 14px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 0 rgba(0,0,0,0.08);
          backdrop-filter: blur(6px);
        }
        .rv-glass-shine {
          position: absolute;
          top: -50%;
          left: -60%;
          width: 60%;
          height: 200%;
          background: linear-gradient(120deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%);
          transform: rotate(20deg);
          animation: rvShineSweep 3.5s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes rvShineSweep {
          0% { left: -60%; }
          35%, 100% { left: 140%; }
        }
        .rv-wave-1 { animation: rvWaveDrift 9s linear infinite; }
        .rv-wave-2 { animation: rvWaveDrift 14s linear infinite reverse; }
        .rv-wave-3 { animation: rvWaveDrift 20s linear infinite; }
        @keyframes rvWaveDrift {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .rv-3d-card { animation: rv3DFloat 6s ease-in-out infinite; transform-style: preserve-3d; }
        @keyframes rv3DFloat {
          0%, 100% { transform: rotateX(0deg) rotateY(0deg) translateZ(0); }
          25% { transform: rotateX(3deg) rotateY(-4deg) translateZ(6px); }
          50% { transform: rotateX(0deg) rotateY(0deg) translateZ(0); }
          75% { transform: rotateX(-3deg) rotateY(4deg) translateZ(6px); }
        }
        .rv-3d-card-light { animation: rv3DFloatLight 7s ease-in-out infinite; transform-style: preserve-3d; }
        @keyframes rv3DFloatLight {
          0%, 100% { transform: rotateX(0deg) rotateY(0deg) translateY(0); box-shadow: 0 6px 16px rgba(22,35,31,0.06); }
          50% { transform: rotateX(2deg) rotateY(-2.5deg) translateY(-2px); box-shadow: 0 12px 24px rgba(22,35,31,0.1); }
        }
        .rv-sidebar { display: none; }
        .rv-content-wrap { }
        @media (min-width: 900px) {
          .rv-app { padding-bottom: 0 !important; }
          .rv-bottomnav { display: none !important; }
          .rv-fab { display: none !important; }
          .rv-mobile-only-logout { display: none !important; }
          .rv-sidebar {
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
          .rv-content-wrap {
            margin-left: 220px;
            max-width: none;
            padding: 0 32px;
          }
        }
      `}</style>

      <div className="rv-sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 32, padding: "0 8px" }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 100 100">
              <polyline points="15,62 40,42 55,56 85,28" stroke="#e8920a" strokeWidth="11" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 17, color: "white" }}>
            RECU<span style={{ color: "#e8920a" }}>VENTE</span>
          </div>
        </div>
        {[
          { key: "dashboard", label: "Commandes", icon: Package },
          { key: "today", label: "Aujourd'hui", icon: ListChecks },
          { key: "validations", label: "Validations", icon: CheckCheck },
          { key: "clients", label: "Clients", icon: Users },
          { key: "livreurs", label: "Livreurs", icon: Truck },
          { key: "closers", label: "Closers", icon: Headset },
        ].filter((t) => !monProfilCloser || t.key !== "closers").map((t) => {
          const Icon = t.icon;
          const active = view === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "11px 12px",
                borderRadius: 9,
                border: "none",
                background: active ? "rgba(255,255,255,0.1)" : "transparent",
                color: active ? "white" : "rgba(255,255,255,0.6)",
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                textAlign: "left",
                marginBottom: 3,
              }}
            >
              <Icon size={18} />
              {t.label}
            </button>
          );
        })}
        <div style={{ marginTop: "auto", padding: "0 12px" }}>
          <button
            onClick={() => (view === "livreurs" ? setShowAddLivreur(true) : view === "closers" ? setShowAddCloser(true) : setShowAdd(true))}
            style={{ width: "100%", padding: "10px 0", borderRadius: 9, border: "none", background: "#e8920a", color: "#16231F", fontWeight: 700, fontSize: 13.5, display: (view === "clients" || (view === "livreurs" && monProfilCloser)) ? "none" : "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 8 }}
          >
            <Plus size={16} /> Ajouter
          </button>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, padding: "0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {session.user.email}
          </div>
          {session.user.email === ADMIN_EMAIL && (
            <>
              <button
                onClick={() => setShowInvite(true)}
                style={{ width: "100%", padding: "8px 0", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.75)", fontWeight: 500, fontSize: 12.5, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Users size={13} /> Inviter quelqu'un
              </button>
              <button
                onClick={() => setShowTeam(true)}
                style={{ width: "100%", padding: "8px 0", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.75)", fontWeight: 500, fontSize: 12.5, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Users size={13} /> Gérer l'équipe
              </button>
              <button
                onClick={() => setShowCampagne(true)}
                style={{ width: "100%", padding: "8px 0", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.75)", fontWeight: 500, fontSize: 12.5, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <MessageCircle size={13} /> Campagne promo
              </button>
              <button
                onClick={() => setShowComptables(true)}
                style={{ width: "100%", padding: "8px 0", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.75)", fontWeight: 500, fontSize: 12.5, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                🧮 Gérer comptables
              </button>
              <button
                onClick={() => setShowProduits(true)}
                style={{ width: "100%", padding: "8px 0", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.75)", fontWeight: 500, fontSize: 12.5, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                📦 Catalogue produits
              </button>
            </>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ width: "100%", padding: "8px 0", borderRadius: 9, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.6)", fontWeight: 500, fontSize: 12.5 }}
          >
            Se déconnecter
          </button>
        </div>
      </div>

      <div className="rv-content-wrap">

      {view === "dashboard" && (
      <>
      <div style={{ background: "#1a7a3c", color: "#FAFAF7", padding: "20px 16px 24px", position: "relative", overflow: "hidden" }}>
        <div className="rv-mesh-blob rv-mesh-1" />
        <div className="rv-mesh-blob rv-mesh-2" />
        <div className="rv-mesh-blob rv-mesh-3" />

        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 90, overflow: "hidden", pointerEvents: "none" }}>
          <svg className="rv-wave rv-wave-1" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", bottom: -5, width: "200%", height: 70 }}>
            <path d="M0,30 C40,10 80,50 120,30 C160,10 200,50 240,30 C280,10 320,50 360,30 C380,20 390,25 400,30 L400,60 L0,60 Z" fill="rgba(232,146,10,0.55)" />
          </svg>
          <svg className="rv-wave rv-wave-2" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", bottom: -8, width: "200%", height: 60 }}>
            <path d="M0,25 C50,45 90,5 140,25 C190,45 230,5 280,25 C330,45 370,5 400,20 L400,60 L0,60 Z" fill="rgba(255,255,255,0.4)" />
          </svg>
          <svg className="rv-wave rv-wave-3" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", bottom: -3, width: "200%", height: 50 }}>
            <path d="M0,35 C60,15 100,45 160,25 C220,5 260,45 320,25 C360,10 380,30 400,25 L400,60 L0,60 Z" fill="rgba(248,180,60,0.4)" />
          </svg>
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8, rowGap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 100 100">
                <polyline points="15,62 40,42 55,56 85,28" stroke="#e8920a" strokeWidth="11" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
              RECU<span style={{ color: "#e8920a" }}>VENTE</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4, opacity: 0.65 }}>
              <span className="rv-livedot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#7fd6a3", display: "inline-block" }} />
              <span style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: "0.03em" }}>EN DIRECT</span>
            </div>
          </div>
          <div className="rv-mobile-only-logout" style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 5, flexShrink: 0, rowGap: 6 }}>
            {session.user.email === ADMIN_EMAIL && (
              <>
                <button
                  onClick={() => setShowInvite(true)}
                  aria-label="Inviter"
                  style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: 7, borderRadius: 7, display: "flex" }}
                >
                  <UserPlus size={15} />
                </button>
                <button
                  onClick={() => setShowTeam(true)}
                  aria-label="Équipe"
                  style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: 7, borderRadius: 7, display: "flex" }}
                >
                  <Users size={15} />
                </button>
                <button
                  onClick={() => setShowCampagne(true)}
                  aria-label="Campagne promo"
                  style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: 7, borderRadius: 7, display: "flex" }}
                >
                  <MessageCircle size={15} />
                </button>
                <button
                  onClick={() => setShowComptables(true)}
                  aria-label="Comptables"
                  style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: 7, borderRadius: 7, display: "flex", fontSize: 14 }}
                >
                  🧮
                </button>
                <button
                  onClick={() => setShowProduits(true)}
                  aria-label="Catalogue produits"
                  style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: 7, borderRadius: 7, display: "flex", fontSize: 14 }}
                >
                  📦
                </button>
              </>
            )}
            <button
              onClick={() => supabase.auth.signOut()}
              aria-label="Déconnexion"
              style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: 7, borderRadius: 7, display: "flex" }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        <div style={{ marginTop: 22, perspective: "800px" }}>
          <div className="rv-3d-card" style={{ position: "relative", padding: "14px 16px", borderRadius: 16, background: "linear-gradient(155deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 70%)", border: "1px solid rgba(255,255,255,0.18)", boxShadow: "0 12px 30px rgba(0,0,0,0.22)" }}>
            <div className="rv-glow" style={{ position: "absolute", top: -20, left: -20, width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,146,10,0.35) 0%, rgba(232,146,10,0) 70%)", pointerEvents: "none" }} />
            <div style={{ fontSize: 12, opacity: 0.75, letterSpacing: "0.04em", textTransform: "uppercase", position: "relative" }}>Argent récupéré</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 38, marginTop: 4, color: "#e8920a", position: "relative" }}>
              {formatFCFA(stats.recupere)}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <div className="rv-glass-card" style={{ flex: 1 }}>
            <div className="rv-glass-shine" />
            <div style={{ fontSize: 11, opacity: 0.75, position: "relative" }}>À risque</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 21, position: "relative" }}>{stats.aRisque}</div>
          </div>
          <div className="rv-glass-card" style={{ flex: 1 }}>
            <div className="rv-glass-shine" />
            <div style={{ fontSize: 11, opacity: 0.75, position: "relative" }}>Taux livraison</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 21, position: "relative" }}>{stats.tauxLivraison}%</div>
          </div>
          <div className="rv-glass-card" style={{ flex: 1 }}>
            <div className="rv-glass-shine" />
            <div style={{ fontSize: 11, opacity: 0.75, position: "relative" }}>Total</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 21, position: "relative" }}>{stats.total}</div>
          </div>
        </div>
        </div>
      </div>

      <div style={{ margin: "14px 20px 0", display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2 }}>
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
            style={{
              padding: "6px 13px",
              borderRadius: 999,
              border: "1px solid " + (datePreset === d.key ? "#1a7a3c" : "#DDD8CC"),
              background: datePreset === d.key ? "#1a7a3c" : "white",
              color: datePreset === d.key ? "white" : "#16231F",
              fontSize: 12.5,
              fontWeight: 500,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      {datePreset === "personnalise" && (
        <div style={{ margin: "8px 20px 0", display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }} />
          <span style={{ color: "#8A9089", fontSize: 12 }}>à</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }} />
        </div>
      )}

      {notifPermission === "default" && (
        <div style={{ margin: "14px 20px 0", background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: "#8A6412" }}>🔔 Active les notifications pour être alerté des nouvelles commandes, même app fermée</span>
          <button
            onClick={activerNotificationsPush}
            style={{ background: "#e8920a", color: "#16231F", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}
          >
            Activer
          </button>
        </div>
      )}

      <div style={{ margin: "14px 20px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, perspective: "700px" }}>
        <div className="rv-3d-card-light" style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px", boxShadow: "0 6px 16px rgba(22,35,31,0.06)" }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em" }}>Chiffre d'affaires</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3 }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 18 }}>{formatFCFA(stats.chiffreAffaires)}</div>
            {evolutionCA !== null && (
              <span style={{ fontSize: 11, fontWeight: 700, color: evolutionCA >= 0 ? "#1F9D6E" : "#D64933" }}>
                {evolutionCA >= 0 ? "+" : ""}{evolutionCA}%
              </span>
            )}
          </div>
        </div>
        <div className="rv-3d-card-light" style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px", boxShadow: "0 6px 16px rgba(22,35,31,0.06)", animationDelay: "-3s" }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em" }}>Taux d'échec</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 18, marginTop: 3, color: "#D64933" }}>{stats.tauxEchec}%</div>
        </div>
      </div>

      <div style={{ margin: "10px 20px 0" }}>
        <button
          onClick={() => setShowComptaDetail(true)}
          className="rv-3d-card-light"
          style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 14, padding: "16px 18px", boxShadow: "0 8px 22px rgba(22,35,31,0.18)", animationDelay: "-1.5s", width: "100%", border: "none", textAlign: "left" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.03em" }}>💰 Bénéfice réel</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 26, marginTop: 3, color: stats.beneficeReel >= 0 ? "#7fd6a3" : "#f0a0a0" }}>
                {formatFCFA(stats.beneficeReel)}
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
              <div>− Livraisons : {stats.livrees} × {formatFCFA(COUT_LIVRAISON)}</div>
              <div style={{ marginTop: 2 }}>− Produits : {formatFCFA(stats.coutProduitsTotal)}</div>
              <div style={{ marginTop: 6, color: "#e8920a", fontWeight: 600 }}>Voir le détail →</div>
            </div>
          </div>
          {stats.nbCoutInconnu > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: "#f0c060", background: "rgba(232,146,10,0.15)", padding: "6px 10px", borderRadius: 7 }}>
              ⚠️ {stats.nbCoutInconnu} commande{stats.nbCoutInconnu > 1 ? "s" : ""} ({formatFCFA(stats.montantCoutInconnu)}) sans coût produit connu — non déduites, bénéfice sous-estimé
            </div>
          )}
        </button>
      </div>

      {clientsSuspects.length > 0 && (
        <div style={{ margin: "14px 20px 0", background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#D64933", marginBottom: 6 }}>⚠️ {clientsSuspects.length} client{clientsSuspects.length > 1 ? "s" : ""} avec 3+ échecs</div>
          {clientsSuspects.slice(0, 3).map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: "#B23A22" }}>{c.nom} ({c.tel}) — {c.echouees} échecs sur {c.total}</div>
          ))}
        </div>
      )}

      {anomaliesProduitZone.length > 0 && (
        <div style={{ margin: "14px 20px 0", background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 12, padding: "12px 14px" }}>
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

      {stats.total > 0 && (
        <div style={{ margin: "16px 20px 0", background: "white", border: "1px solid #ECE8DC", borderRadius: 14, padding: "18px 20px", display: "flex", alignItems: "center", gap: 20 }}>
          <StatusDonut livrees={stats.livrees} enAttente={stats.enAttente} echouees={stats.echouees} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS.confirmee.color, display: "inline-block" }} />
              Livrées <span style={{ marginLeft: "auto", fontWeight: 600 }}>{stats.livrees}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS.en_cours.color, display: "inline-block" }} />
              En attente <span style={{ marginLeft: "auto", fontWeight: 600 }}>{stats.enAttente}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: STATUS.echouee.color, display: "inline-block" }} />
              Échouées <span style={{ marginLeft: "auto", fontWeight: 600 }}>{stats.echouees}</span>
            </div>
          </div>
        </div>
      )}

      {evolution.length > 1 && (
        <div style={{ margin: "14px 20px 0", background: "white", border: "1px solid #ECE8DC", borderRadius: 14, padding: "18px 20px 14px" }}>
          <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>Évolution des commandes</div>
          <EvolutionChart data={evolution} />
        </div>
      )}

      {(meilleurProduit || meilleurLivreur) && (
        <div style={{ margin: "14px 20px 0", display: "flex", flexDirection: "column", gap: 8 }}>
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

      {produits.length > 0 && (
        <div style={{ margin: "14px 20px 0", background: "white", border: "1px solid #ECE8DC", borderRadius: 14, padding: "18px 20px 14px" }}>
          <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 12 }}>Produits (période sélectionnée)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {produits.slice(0, 6).map((p, i) => {
              const maxV = produits[0].ventes || 1;
              return (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                    <span>{p.nom}</span>
                    <span style={{ fontWeight: 600 }}>{p.ventes} · {formatFCFA(p.revenus)}</span>
                  </div>
                  <div style={{ background: "#ECE8DC", borderRadius: 999, height: 6, overflow: "hidden" }}>
                    <div style={{ width: `${(p.ventes / maxV) * 100}%`, background: "#e8920a", height: "100%", borderRadius: 999 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {produitsQuantiteDetail.length > 0 && (
        <div style={{ margin: "14px 20px 0", background: "white", border: "1px solid #ECE8DC", borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 12 }}>📦 Quantités par produit</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {produitsQuantiteDetail.map((p) => (
              <div key={p.nom} style={{ background: "#FAFAF7", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{p.nom}</span>
                <div style={{ display: "flex", gap: 10, fontSize: 11.5 }}>
                  <span style={{ color: "#8A9089" }}>{p.assignes} au total</span>
                  <span style={{ color: "#1F9D6E" }}>{p.livres} livrés</span>
                  <span style={{ color: p.restants > 0 ? "#D64933" : "#8A9089", fontWeight: 600 }}>{p.restants} restants</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, padding: "14px 20px 0" }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher un client ou numéro..."
          style={{ flex: 1, padding: "9px 12px", borderRadius: 9, border: "1px solid #DDD8CC", fontSize: 13.5, background: "white" }}
        />
        <button
          onClick={() => exportCSV(filtered)}
          aria-label="Exporter en CSV"
          style={{ background: "white", border: "1px solid #DDD8CC", borderRadius: 9, padding: "0 13px", color: "#1a7a3c", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }}
        >
          Exporter
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "16px 20px 8px", overflowX: "auto" }}>
        {[
          { key: "toutes", label: "Toutes" },
          { key: "echouee", label: "Échouées" },
          { key: "en_cours", label: "En cours" },
          { key: "confirmee", label: "Confirmées" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: "7px 14px",
              borderRadius: 999,
              border: "1px solid " + (filter === f.key ? "#1a7a3c" : "#DDD8CC"),
              background: filter === f.key ? "#1a7a3c" : "white",
              color: filter === f.key ? "white" : "#16231F",
              fontSize: 13,
              fontWeight: 500,
              whiteSpace: "nowrap",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {(livreurs.length > 0 || produits.length > 0) && (
        <div style={{ display: "flex", gap: 8, padding: "0 20px 8px" }}>
          {livreurs.length > 0 && (
            <select
              value={filterLivreur}
              onChange={(e) => setFilterLivreur(e.target.value)}
              style={{ flex: 1, padding: "7px 8px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 12.5, background: "white", color: filterLivreur === "tous" ? "#8A9089" : "#16231F" }}
            >
              <option value="tous">Tous les livreurs</option>
              {livreurs.map((l) => (
                <option key={l.id} value={l.nom}>{l.nom}</option>
              ))}
            </select>
          )}
          {produits.length > 0 && (
            <select
              value={filterProduit}
              onChange={(e) => setFilterProduit(e.target.value)}
              style={{ flex: 1, padding: "7px 8px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 12.5, background: "white", color: filterProduit === "tous" ? "#8A9089" : "#16231F" }}
            >
              <option value="tous">Tous les produits</option>
              {produits.map((p) => (
                <option key={p.nom} value={p.nom}>{p.nom}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div style={{ padding: "8px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#8A9089", fontSize: 14 }}>
            Aucune commande dans ce filtre.
          </div>
        )}
        {groupedByDay.map((group, gi) => (
          <div key={gi} style={{ marginBottom: 8 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: "#1a7a3c",
                textTransform: "capitalize",
                padding: "10px 2px 8px",
                position: "sticky",
                top: 0,
                background: "#FAFAF7",
                zIndex: 5,
              }}
            >
              {group.label} <span style={{ color: "#8A9089", fontWeight: 500 }}>({group.orders.length})</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {group.orders.map((o) => {
                const s = STATUS[o.statut];
                return (
                  <button
                    key={o.id}
                    onClick={() => setSelected(o)}
                    style={{
                      textAlign: "left",
                      background: "white",
                      border: "1px solid #ECE8DC",
                      borderLeft: `4px solid ${s.color}`,
                      borderRadius: 10,
                      padding: "12px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{o.client}</div>
                      <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{o.produit} · {o.zone}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11.5, color: s.color, fontWeight: 500 }}>{o.derniere_tentative}</span>
                        {relanceCountByOrder.count[o.id] > 0 && (
                          <span style={{ fontSize: 10.5, color: "#1a7a3c", background: "#EAF3DE", padding: "1px 7px", borderRadius: 999, fontWeight: 600 }}>
                            {relanceCountByOrder.count[o.id]} relance{relanceCountByOrder.count[o.id] > 1 ? "s" : ""}
                          </span>
                        )}
                        {o.type_livraison === "expedition" && (
                          <span style={{ fontSize: 10.5, fontWeight: 600, color: o.depot_recu ? "#3B6D11" : "#B23A22", background: o.depot_recu ? "#EAF3DE" : "#FBEAE6", padding: "1px 7px", borderRadius: 999 }}>
                            📦 {o.depot_recu ? "Dépôt reçu" : "En attente dépôt"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 15 }}>{formatFCFA(o.montant + (o.frais_expedition || 0))}</div>
                      <div style={{ fontSize: 11, marginTop: 4, padding: "2px 8px", borderRadius: 999, background: s.bg, color: s.color, display: "inline-block", fontWeight: 500 }}>
                        {s.label}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      </>
      )}

      {view === "today" && (
        <div className="rv-fadein">
          <TodayView
            todo={todoAujourdhui}
            onSelectOrder={(o) => { setView("dashboard"); setSelected(o); }}
            onRelancerTout={() => setShowBatch(true)}
            clientsARelancer={clientsARelancer}
            monProfilCloser={monProfilCloser}
            commandesNonAssigneesListe={monProfilCloser ? orders.filter((o) => !o.closer && (o.statut === "en_cours" || o.statut === "echouee")) : []}
            onSeAttribuer={seAttribuerCommande}
            enAttenteDepot={orders.filter((o) => o.type_livraison === "expedition" && !o.depot_recu && (o.statut === "en_cours" || o.statut === "echouee"))}
          />
        </div>
      )}

      {view === "validations" && (
        <div className="rv-fadein">
          <ValidationsView
            orders={orders}
            onSelectOrder={(o) => { setView("dashboard"); setSelected(o); }}
          />
        </div>
      )}

      {view === "clients" && (
        <div className="rv-fadein">
          <ClientsView clients={clients} onSelect={setSelectedClient} />
        </div>
      )}

      {view === "livreurs" && (
        <div className="rv-fadein">
          <LivreursView livreurs={livreursStats} onDelete={deleteLivreur} readOnly={!!monProfilCloser} periodLabel={periodLabel} />
        </div>
      )}

      {view === "closers" && (
        <div className="rv-fadein">
          <ClosersView closers={closersStats} onDelete={deleteCloser} nonAssignees={commandesNonAssignees} periodLabel={periodLabel} />
        </div>
      )}

      </div>

      <div
        className="rv-bottomnav"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "white",
          borderTop: "1px solid #ECE8DC",
          display: "flex",
          padding: "8px 12px",
          paddingBottom: "calc(8px + env(safe-area-inset-bottom))",
          zIndex: 20,
        }}
      >
        {[
          { key: "dashboard", label: "Commandes", icon: Package },
          { key: "today", label: "Aujourd'hui", icon: ListChecks },
          { key: "validations", label: "Validations", icon: CheckCheck },
          { key: "clients", label: "Clients", icon: Users },
          { key: "livreurs", label: "Livreurs", icon: Truck },
          { key: "closers", label: "Closers", icon: Headset },
        ].filter((t) => !monProfilCloser || t.key !== "closers").map((t) => {
          const Icon = t.icon;
          const active = view === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
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
              }}
            >
              <Icon size={20} />
              <span style={{ fontSize: 11, fontWeight: active ? 600 : 500 }}>{t.label}</span>
            </button>
          );
        })}
      </div>

      <button
        className="rv-fab"
        onClick={() => (view === "livreurs" ? setShowAddLivreur(true) : view === "closers" ? setShowAddCloser(true) : setShowAdd(true))}
        style={{
          position: "fixed",
          bottom: 84,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: "#1a7a3c",
          color: "white",
          border: "none",
          display: (view === "clients" || (view === "livreurs" && monProfilCloser)) ? "none" : "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 6px 18px rgba(15,61,62,0.35)",
        }}
        aria-label="Ajouter"
      >
        <Plus size={24} />
      </button>

      {toast && (
        <div style={{ position: "fixed", bottom: 150, left: "50%", transform: "translateX(-50%)", background: "#16231F", color: "white", padding: "9px 18px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>
          {toast}
        </div>
      )}

      {selected && (
        <OrderDetail
          order={selected}
          onClose={() => setSelected(null)}
          onStatus={updateStatus}
          livreurs={livreurs}
          onAssignLivreur={assignLivreur}
          closers={monProfilCloser ? null : closers}
          onAssignCloser={assignCloser}
          onReschedule={rescheduleOrder}
          onRelanceAdded={loadRelances}
          onUpdateInfos={updateOrderInfos}
          onMarquerDepot={marquerDepot}
        />
      )}
      {showAdd && <AddOrder onClose={() => setShowAdd(false)} onAdd={addOrder} />}
      {showAddLivreur && <AddLivreur onClose={() => setShowAddLivreur(false)} onAdd={addLivreur} />}
      {showAddCloser && <AddCloser onClose={() => setShowAddCloser(false)} onAdd={addCloser} />}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {showTeam && <TeamModal onClose={() => setShowTeam(false)} currentUserId={session.user.id} />}
      {celebration && <CelebrationOverlay montant={celebration.montant} client={celebration.client} />}
      {showBatch && (
        <BatchRelanceModal
          orders={[...todoAujourdhui.aRelivrer, ...todoAujourdhui.jamaisContactees, ...todoAujourdhui.sansNouvelles]}
          onClose={() => setShowBatch(false)}
          onLog={logRelance}
        />
      )}
      {showCampagne && <CampagneModal clients={clients} onClose={() => setShowCampagne(false)} />}
      {showComptables && <ComptablesModal comptables={comptables} onDelete={deleteComptable} onAddClick={() => setShowAddComptable(true)} onClose={() => setShowComptables(false)} />}
      {showAddComptable && <AddComptable onClose={() => setShowAddComptable(false)} onAdd={addComptable} />}
      {showComptaDetail && (
        <ComptaDetailModal
          stats={stats}
          livreursStats={livreursStats}
          coutLivraison={COUT_LIVRAISON}
          periodLabel={periodLabel}
          orders={orders}
          livreurs={livreurs}
          repartitionCloserLivreur={repartitionCloserLivreur}
          onClose={() => setShowComptaDetail(false)}
        />
      )}
      {showProduits && (
        <ProduitsModal
          produits={catalogueProduits}
          onDelete={deleteProduit}
          onUpdateCout={updateProduitCout}
          onUpdateStock={updateProduitStock}
          quantitesParProduit={quantitesParProduit}
          onAddClick={() => setShowAddProduit(true)}
          onClose={() => setShowProduits(false)}
        />
      )}
      {showAddProduit && <AddProduit onClose={() => setShowAddProduit(false)} onAdd={addProduit} />}
      {selectedClient && <ClientDetail client={selectedClient} onClose={() => setSelectedClient(null)} onSelectOrder={(o) => { setSelectedClient(null); setView("dashboard"); setSelected(o); }} />}
    </div>
  );
}

function EvolutionChart({ data }) {
  const w = 300;
  const h = 110;
  const padL = 4;
  const padR = 4;
  const padT = 8;
  const padB = 20;
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
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#1a7a3c" />
      ))}
      {points.map((p, i) => {
        if (data.length > 8 && i % Math.ceil(data.length / 6) !== 0 && i !== data.length - 1) return null;
        return (
          <text key={"t" + i} x={p.x} y={h + 8} fontSize="8" fill="#8A9089" textAnchor="middle" fontFamily="'IBM Plex Sans', sans-serif">
            {p.d.label}
          </text>
        );
      })}
    </svg>
  );
}

function StatusDonut({ livrees, enAttente, echouees }) {
  const total = livrees + enAttente + echouees || 1;
  const r = 34;
  const circ = 2 * Math.PI * r;
  const segs = [
    { val: livrees, color: STATUS.confirmee.color },
    { val: enAttente, color: STATUS.en_cours.color },
    { val: echouees, color: STATUS.echouee.color },
  ];
  let offset = 0;
  return (
    <svg width="92" height="92" viewBox="0 0 92 92" style={{ flexShrink: 0 }}>
      <circle cx="46" cy="46" r={r} fill="none" stroke="#ECE8DC" strokeWidth="12" />
      {segs.map((s, i) => {
        const frac = s.val / total;
        const len = frac * circ;
        const el = (
          <circle
            key={i}
            cx="46"
            cy="46"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="12"
            strokeDasharray={`${len} ${circ - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 46 46)"
          />
        );
        offset += len;
        return el;
      })}
      <text x="46" y="50" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontWeight="600" fontSize="18" fill="#16231F">
        {livrees + enAttente + echouees}
      </text>
    </svg>
  );
}

function OrderDetail({ order, onClose, onStatus, livreurs, onAssignLivreur, closers, onAssignCloser, onReschedule, onRelanceAdded, onUpdateInfos, onMarquerDepot }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ client: order.client, tel: order.tel, zone: order.zone, produit: order.produit, montant: order.montant, type_livraison: order.type_livraison || "abidjan", frais_expedition: order.frais_expedition, montant_depot: order.montant_depot, depot_recu: order.depot_recu });
  const [saving, setSaving] = useState(false);

  async function enregistrer() {
    setSaving(true);
    await onUpdateInfos(order.id, {
      client: form.client,
      tel: form.tel,
      zone: form.zone,
      produit: form.produit,
      montant: Number(form.montant),
      type_livraison: form.type_livraison || "abidjan",
      frais_expedition: Number(form.frais_expedition) || 0,
      montant_depot: Number(form.montant_depot) || 0,
      depot_recu: !!form.depot_recu,
    });
    setSaving(false);
    setEditing(false);
  }

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", padding: 4 }}>
            <ChevronLeft size={22} />
          </button>
          {!editing ? (
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19, flex: 1 }}>{order.client}</div>
          ) : (
            <div style={{ flex: 1, fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Modifier la commande</div>
          )}
          <button
            onClick={() => (editing ? enregistrer() : setEditing(true))}
            disabled={saving}
            style={{ background: editing ? "#1a7a3c" : "none", color: editing ? "white" : "#1a7a3c", border: editing ? "none" : "1px solid #1a7a3c", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600 }}
          >
            {saving ? "..." : editing ? "Enregistrer" : "✏️ Modifier"}
          </button>
        </div>

        {!editing ? (
          <div style={{ display: "flex", gap: 8, fontSize: 13, color: "#6B7168", marginBottom: 14 }}>
            <span>{order.tel}</span>·<span>{order.zone}</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: "#8A9089", display: "block", marginBottom: 3 }}>Zone de livraison</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setForm({ ...form, type_livraison: "abidjan" })}
                  style={{ flex: 1, padding: "8px 6px", borderRadius: 8, border: `2px solid ${(form.type_livraison || "abidjan") !== "expedition" ? "#1a7a3c" : "#DDD8CC"}`, background: (form.type_livraison || "abidjan") !== "expedition" ? "#EAF3DE" : "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  🏍️ Abidjan
                </button>
                <button
                  onClick={() => setForm({ ...form, type_livraison: "expedition" })}
                  style={{ flex: 1, padding: "8px 6px", borderRadius: 8, border: `2px solid ${form.type_livraison === "expedition" ? "#e8920a" : "#DDD8CC"}`, background: form.type_livraison === "expedition" ? "#FBF3E3" : "white", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  📦 Hors Abidjan
                </button>
              </div>
            </div>
            {["client", "tel", "produit", "montant", "zone"].map((f) => (
              <div key={f}>
                <label style={{ fontSize: 11, color: "#8A9089", display: "block", marginBottom: 3, textTransform: "capitalize" }}>
                  {f === "tel" ? "Téléphone" : f === "montant" ? "Montant (FCFA)" : f}
                </label>
                <input
                  value={form[f]}
                  onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                  type={f === "montant" ? "number" : "text"}
                  style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13.5, background: "white" }}
                />
              </div>
            ))}
            {form.type_livraison === "expedition" && (
              <>
                <div>
                  <label style={{ fontSize: 11, color: "#8A9089", display: "block", marginBottom: 3 }}>Frais d'expédition (FCFA)</label>
                  <input
                    value={form.frais_expedition ?? order.frais_expedition ?? ""}
                    onChange={(e) => setForm({ ...form, frais_expedition: e.target.value })}
                    type="number"
                    style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13.5, background: "white" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#8A9089", display: "block", marginBottom: 3 }}>Montant du dépôt reçu (FCFA)</label>
                  <input
                    value={form.montant_depot ?? order.montant_depot ?? ""}
                    onChange={(e) => setForm({ ...form, montant_depot: e.target.value, depot_recu: Number(e.target.value) > 0 })}
                    type="number"
                    style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13.5, background: "white" }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {!editing && (
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.04em" }}>Commande</div>
          <div style={{ fontWeight: 600, marginTop: 2 }}>{order.produit}</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 20, marginTop: 6, color: "#1a7a3c" }}>{formatFCFA(order.montant)}</div>
        </div>
        )}

        {!editing && order.type_livraison === "expedition" && (
          <div style={{ background: order.depot_recu ? "#EAF3DE" : "#FBEAE6", border: `1px solid ${order.depot_recu ? "#C7DDA3" : "#F0B8AC"}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: order.depot_recu ? "#3B6D11" : "#B23A22", marginBottom: 8 }}>
              📦 Expédition hors Abidjan
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ color: "#6B7168" }}>Frais d'expédition</span>
              <span style={{ fontWeight: 600 }}>{formatFCFA(order.frais_expedition || 0)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 8 }}>
              <span style={{ color: "#6B7168" }}>Total à collecter</span>
              <span style={{ fontWeight: 700 }}>{formatFCFA(order.montant + (order.frais_expedition || 0))}</span>
            </div>
            <div style={{ height: 1, background: "rgba(0,0,0,0.08)", margin: "8px 0" }} />
            {order.depot_recu ? (
              <div style={{ fontSize: 12.5, color: "#3B6D11", fontWeight: 600 }}>
                ✅ Dépôt reçu : {formatFCFA(order.montant_depot || 0)}
                {order.depot_recu_le && <div style={{ fontWeight: 400, fontSize: 11, marginTop: 2 }}>le {new Date(order.depot_recu_le).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</div>}
              </div>
            ) : (
              <button
                onClick={() => {
                  const montant = prompt("Montant du dépôt reçu (FCFA) :");
                  if (montant && Number(montant) > 0) onMarquerDepot(order.id, Number(montant));
                }}
                style={{ width: "100%", background: "#1a7a3c", color: "white", border: "none", borderRadius: 8, padding: "10px 0", fontWeight: 700, fontSize: 13, cursor: "pointer" }}
              >
                💰 Marquer le dépôt comme reçu
              </button>
            )}

            {order.expedition_confirmee && order.photo_recu_expedition && (
              <div style={{ marginTop: 12 }}>
                <img
                  src={order.photo_recu_expedition}
                  alt="Reçu d'expédition"
                  style={{ width: "100%", borderRadius: 8, marginBottom: 8, border: "1px solid #ECE8DC" }}
                />
                <a
                  href={`https://wa.me/${cleanPhoneForWhatsApp(order.tel)}?text=${encodeURIComponent(`Bonjour ${order.client.split(" ")[0]} 👋, voici votre reçu d'expédition pour retirer votre colis à ${order.zone || "destination"} :\n\n${order.photo_recu_expedition}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "block", textAlign: "center", width: "100%", background: "#1F9D6E", color: "white", padding: "10px 0", borderRadius: 8, fontWeight: 700, fontSize: 12.5, textDecoration: "none", boxSizing: "border-box" }}
                >
                  💬 Envoyer le reçu au client (WhatsApp)
                </a>
              </div>
            )}

            {order.depot_recu && !order.expedition_confirmee && (
              <div style={{ marginTop: 10, background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 8, padding: "8px 10px", fontSize: 11.5, color: "#8A6412" }}>
                ⏳ En attente que le livreur confirme l'expédition avec une photo du reçu.
              </div>
            )}
          </div>
        )}

        {livreurs && livreurs.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Livreur assigné</div>
            <select
              value={order.livreur || ""}
              onChange={(e) => onAssignLivreur(order.id, e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
            >
              <option value="">Non assigné</option>
              {livreurs.map((l) => (
                <option key={l.id} value={l.nom}>{l.nom}</option>
              ))}
            </select>
          </div>
        )}

        {closers && closers.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Closer assigné</div>
            <select
              value={order.closer || ""}
              onChange={(e) => onAssignCloser(order.id, e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
            >
              <option value="">Non assigné</option>
              {closers.map((c) => (
                <option key={c.id} value={c.nom}>{c.nom}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Statut</div>
          <div style={{ display: "flex", gap: 8 }}>
            {Object.entries(STATUS).map(([key, val]) => {
              const bloqueDepot = key === "confirmee" && order.type_livraison === "expedition" && !order.depot_recu;
              return (
                <button
                  key={key}
                  onClick={() => !bloqueDepot && onStatus(order.id, key)}
                  disabled={bloqueDepot}
                  title={bloqueDepot ? "Le dépôt doit être reçu avant de confirmer" : undefined}
                  style={{
                    flex: 1,
                    padding: "8px 6px",
                    borderRadius: 8,
                    border: `1px solid ${order.statut === key ? val.color : "#DDD8CC"}`,
                    background: bloqueDepot ? "#F0EEE6" : order.statut === key ? val.bg : "white",
                    color: bloqueDepot ? "#B0AB9E" : order.statut === key ? val.color : "#6B7168",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: bloqueDepot ? "not-allowed" : "pointer",
                  }}
                >
                  {bloqueDepot ? "🔒 " + val.label : val.label}
                </button>
              );
            })}
          </div>
          {order.type_livraison === "expedition" && !order.depot_recu && (
            <div style={{ fontSize: 11, color: "#B23A22", marginTop: 5 }}>Reçois d'abord le dépôt avant de pouvoir confirmer cette expédition.</div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Reprogrammer la livraison</div>
          <input
            type="date"
            value={order.date_relivraison || ""}
            onChange={(e) => onReschedule(order.id, e.target.value)}
            style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13.5, background: "white" }}
          />
          {order.date_relivraison && (
            <div style={{ fontSize: 12, color: "#1a7a3c", marginTop: 5, fontWeight: 600 }}>
              📅 Prévue le {new Date(order.date_relivraison + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
            </div>
          )}
        </div>

        <RelancesHistorique key={`${order.id}-${order.statut}-${order.livreur}-${order.closer}-${order.date_relivraison}`} orderId={order.id} onAdded={onRelanceAdded} />

        <div style={{ background: "#EAF7F1", border: "1px solid #CFEBDD", borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#1F9D6E", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            <Phone size={13} /> Script d'appel suggéré
          </div>
          <div style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>{scriptAppel(order)}</div>
        </div>

        {order.statut !== "confirmee" && (
          <a
            href={`https://wa.me/${cleanPhoneForWhatsApp(order.tel)}?text=${encodeURIComponent(`Bonjour ${order.client.split(" ")[0]} 👋, suivez votre commande en direct ici : ${window.location.origin}/?suivi=${order.id}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "white", border: "1px solid #DDD8CC", color: "#16231F", padding: "12px 0", borderRadius: 10, fontWeight: 600, fontSize: 13.5, textDecoration: "none", marginBottom: 14 }}
          >
            🔗 Envoyer le lien de suivi au client
          </a>
        )}

        {order.statut === "confirmee" && (
          <a
            href={merciWaLink(order)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "linear-gradient(135deg, #e8920a, #f0b94a)", color: "white", padding: "13px 0", borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: "none", marginBottom: 14 }}
          >
            🙏 Envoyer message de remerciement + reçu
          </a>
        )}

        <button
          onClick={() => genererFacturePDF(order)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "white", border: "1px solid #DDD8CC", color: "#16231F", padding: "12px 0", borderRadius: 10, fontWeight: 600, fontSize: 13.5, marginBottom: 14 }}
        >
          🧾 Envoyer / Télécharger la facture PDF
        </button>

        <div style={{ display: "flex", gap: 10 }}>
          <a href={waLink(order)} target="_blank" rel="noopener noreferrer" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#1F9D6E", color: "white", padding: "12px 0", borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
            <MessageCircle size={17} /> WhatsApp
          </a>
          <a href={`sms:${order.tel}?body=${encodeURIComponent(smsMsg(order))}`} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#1a7a3c", color: "white", padding: "12px 0", borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
            <MessageSquare size={17} /> SMS
          </a>
          <a href={`tel:${order.tel}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "white", border: "1px solid #DDD8CC", color: "#16231F", padding: "12px 18px", borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
            <Phone size={17} />
          </a>
        </div>
      </div>
    </div>
  );
}

function AddOrder({ onClose, onAdd }) {
  const [form, setForm] = useState({ client: "", tel: "", produit: "", montant: "", zone: "", statut: "en_cours", derniere_tentative: "Nouvelle commande", type_livraison: "abidjan", frais_expedition: "", montant_depot: "", depot_recu: false });
  const montantValide = Number(form.montant) > 0;
  const estExpedition = form.type_livraison === "expedition";
  const canSubmit = form.client.trim() && form.tel.trim() && form.produit.trim() && montantValide;

  const totalAvecFrais = Number(form.montant || 0) + Number(form.frais_expedition || 0);

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px", maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Nouvelle commande</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 6 }}>Zone de livraison</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button
            onClick={() => setForm({ ...form, type_livraison: "abidjan" })}
            style={{ flex: 1, padding: "12px 10px", borderRadius: 10, border: `2px solid ${!estExpedition ? "#1a7a3c" : "#DDD8CC"}`, background: !estExpedition ? "#EAF3DE" : "white", textAlign: "left", cursor: "pointer" }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>🏍️ Abidjan</div>
            <div style={{ fontSize: 10.5, color: "#6B7168" }}>Paiement à la livraison</div>
          </button>
          <button
            onClick={() => setForm({ ...form, type_livraison: "expedition" })}
            style={{ flex: 1, padding: "12px 10px", borderRadius: 10, border: `2px solid ${estExpedition ? "#e8920a" : "#DDD8CC"}`, background: estExpedition ? "#FBF3E3" : "white", textAlign: "left", cursor: "pointer" }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>📦 Hors Abidjan</div>
            <div style={{ fontSize: 10.5, color: "#6B7168" }}>Expédition avec dépôt</div>
          </button>
        </div>

        {["client", "tel", "produit", "montant", "zone"].map((field) => (
          <div key={field} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4, textTransform: "capitalize" }}>
              {field === "tel" ? "Téléphone" : field === "montant" ? "Montant produit (FCFA)" : field === "zone" ? (estExpedition ? "Ville / région" : "zone") : field}
            </label>
            <input
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              type={field === "montant" ? "number" : "text"}
              min={field === "montant" ? "1" : undefined}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
            />
            {field === "montant" && form.montant && !montantValide && (
              <div style={{ color: "#D64933", fontSize: 11.5, marginTop: 4 }}>Le montant doit être supérieur à 0.</div>
            )}
          </div>
        ))}

        {estExpedition && (
          <div style={{ background: "white", border: "1px solid #F0DDA8", borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#8A6412", marginBottom: 10 }}>📦 Détails expédition</div>

            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Frais d'expédition (FCFA)</label>
            <input
              value={form.frais_expedition}
              onChange={(e) => setForm({ ...form, frais_expedition: e.target.value })}
              type="number"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white", marginBottom: 10, boxSizing: "border-box" }}
            />

            {totalAvecFrais > 0 && (
              <div style={{ background: "#FBF3E3", borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 12.5, color: "#8A6412" }}>
                Total à collecter : <strong>{totalAvecFrais.toLocaleString("fr-FR")} FCFA</strong>
              </div>
            )}

            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Montant du dépôt reçu (FCFA)</label>
            <input
              value={form.montant_depot}
              onChange={(e) => setForm({ ...form, montant_depot: e.target.value, depot_recu: Number(e.target.value) > 0 })}
              type="number"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white", boxSizing: "border-box" }}
            />
            <div style={{ fontSize: 11, color: "#8A9089", marginTop: 4 }}>Laisse à 0 si le dépôt n'a pas encore été reçu — le colis ne sera pas marqué prêt à expédier.</div>
          </div>
        )}

        <button
          disabled={!canSubmit}
          onClick={() => canSubmit && onAdd(form)}
          style={{ width: "100%", marginTop: 6, padding: "13px 0", borderRadius: 10, border: "none", background: canSubmit ? "#1a7a3c" : "#DDD8CC", color: "white", fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Check size={17} /> Ajouter la commande
        </button>
      </div>
    </div>
  );
}

function ClientsView({ clients, onSelect }) {
  return (
    <div style={{ padding: "20px 20px 8px" }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, marginBottom: 4 }}>Clients</div>
      <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 18 }}>{clients.length} client{clients.length > 1 ? "s" : ""} · classés par argent dépensé</div>

      {clients.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#8A9089", fontSize: 14 }}>Aucun client pour l'instant.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {clients.map((c, i) => (
          <button
            key={i}
            onClick={() => onSelect(c)}
            style={{ textAlign: "left", background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {i < 3 && c.montantTotal > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#e8920a", background: "#FBF3E3", padding: "1px 7px", borderRadius: 999 }}>🏆 TOP CLIENT</span>}
                {c.joursDeRetard !== null && c.joursDeRetard >= 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#1a7a3c", background: "#EAF3DE", padding: "1px 7px", borderRadius: 999 }}>🔄 À relancer</span>}
                {c.nom}
              </div>
              <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{c.tel} · {c.zone}</div>
              {c.produitPrefere && (
                <div style={{ fontSize: 11.5, color: "#8A9089", marginTop: 3 }}>Préfère : {c.produitPrefere}</div>
              )}
              <div style={{ fontSize: 12, marginTop: 5, display: "flex", gap: 10 }}>
                <span style={{ color: "#1a7a3c" }}>{c.confirmees} livrée{c.confirmees > 1 ? "s" : ""}</span>
                {c.echouees > 0 && <span style={{ color: "#D64933" }}>{c.echouees} échouée{c.echouees > 1 ? "s" : ""}</span>}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, color: "#1a7a3c" }}>{formatFCFA(c.montantTotal)}</div>
              <div style={{ fontSize: 10.5, color: "#8A9089" }}>{c.total} commande{c.total > 1 ? "s" : ""}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ClientDetail({ client, onClose, onSelectOrder }) {
  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", padding: 4 }}>
            <ChevronLeft size={22} />
          </button>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>{client.nom}</div>
        </div>
        <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 16 }}>{client.tel} · {client.zone}</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, color: "#3B6D11", textTransform: "uppercase", letterSpacing: "0.03em" }}>Total dépensé</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 17, color: "#3B6D11", marginTop: 2 }}>{formatFCFA(client.montantTotal)}</div>
          </div>
          {client.produitPrefere && (
            <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 10.5, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em" }}>Produit préféré</div>
              <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 2 }}>{client.produitPrefere}</div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <a
            href={`https://wa.me/${cleanPhoneForWhatsApp(client.tel)}?text=${encodeURIComponent(`Bonjour ${client.nom.split(" ")[0]} 👋, c'est Azali Express. Comment pouvons-nous vous aider ?`)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#1F9D6E", color: "white", padding: "11px 0", borderRadius: 10, fontWeight: 600, fontSize: 13.5, textDecoration: "none" }}
          >
            <MessageCircle size={16} /> WhatsApp
          </a>
          <a
            href={`sms:${client.tel}?body=${encodeURIComponent(`Azali Express: Bonjour ${client.nom.split(" ")[0]}, comment pouvons-nous vous aider ?`)}`}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#1a7a3c", color: "white", padding: "11px 0", borderRadius: 10, fontWeight: 600, fontSize: 13.5, textDecoration: "none" }}
          >
            <MessageSquare size={16} /> SMS
          </a>
          <a
            href={`tel:${client.tel}`}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "white", border: "1px solid #DDD8CC", color: "#16231F", padding: "11px 16px", borderRadius: 10, fontWeight: 600, fontSize: 13.5, textDecoration: "none" }}
          >
            <Phone size={16} />
          </a>
        </div>

        <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
          Historique des commandes ({client.commandes.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {client.commandes.map((o) => {
            const s = STATUS[o.statut];
            return (
              <button
                key={o.id}
                onClick={() => onSelectOrder(o)}
                style={{ textAlign: "left", background: "white", border: "1px solid #ECE8DC", borderLeft: `4px solid ${s.color}`, borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between" }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{o.produit}</div>
                  <div style={{ fontSize: 11.5, color: s.color, marginTop: 3, fontWeight: 500 }}>{s.label}</div>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 14 }}>{formatFCFA(o.montant)}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LivreursView({ livreurs, onDelete, readOnly, periodLabel }) {
  const maxTaux = Math.max(...livreurs.map((l) => l.taux ?? 0), 1);
  const medailles = ["🥇", "🥈", "🥉"];
  const totalDu = livreurs.reduce((s, l) => s + (l.montantDu || 0), 0);
  const totalADeposer = livreurs.reduce((s, l) => s + (l.montantADeposer || 0), 0);

  return (
    <div style={{ padding: "20px 20px 8px" }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, marginBottom: 4 }}>Livreurs</div>
      <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 4 }}>{livreurs.length} livreur{livreurs.length > 1 ? "s" : ""} · classés par taux de réussite</div>
      {periodLabel && (
        <div style={{ display: "inline-block", fontSize: 11, fontWeight: 600, color: "#1a7a3c", background: "#EAF3DE", padding: "3px 10px", borderRadius: 999, marginBottom: 14 }}>
          📊 {periodLabel}
        </div>
      )}

      {(totalDu > 0 || totalADeposer > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.03em" }}>💵 À payer aux livreurs</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, color: "#e8920a", marginTop: 3 }}>{formatFCFA(totalDu)}</div>
          </div>
          <div style={{ background: "linear-gradient(135deg, #1a7a3c, #1F9D6E)", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.75)", textTransform: "uppercase", letterSpacing: "0.03em" }}>🏦 Dépôt attendu</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, color: "white", marginTop: 3 }}>{formatFCFA(totalADeposer)}</div>
          </div>
        </div>
      )}

      <CarteLivreurs livreurs={livreurs} />

      {livreurs.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#8A9089", fontSize: 14 }}>Aucun livreur ajouté.{!readOnly && ' Appuie sur "+" pour en ajouter un.'}</div>
      )}

      {livreurs.length > 1 && (
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "16px 16px 10px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 12 }}>Comparatif — taux de réussite</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {livreurs.map((l) => (
              <div key={l.id}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                  <span>{l.nom}</span>
                  <span style={{ fontWeight: 600 }}>{l.taux !== null ? l.taux + "%" : "—"}</span>
                </div>
                <div style={{ background: "#ECE8DC", borderRadius: 999, height: 7, overflow: "hidden" }}>
                  <div style={{ width: `${((l.taux ?? 0) / maxTaux) * 100}%`, background: "#1a7a3c", height: "100%", borderRadius: 999 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {livreurs.map((l, i) => (
          <div key={l.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                  {i < 3 && total_ok(l) ? medailles[i] : null} {l.nom}
                </div>
                <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{l.telephone} · {l.zone}</div>
              </div>
              {!readOnly && (
                <button onClick={() => onDelete(l.id)} style={{ background: "none", border: "none", color: "#D64933", padding: 6 }} aria-label="Retirer">
                  <Trash2 size={17} />
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12.5 }}>
              <span style={{ color: "#6B7168" }}>{l.total} commande{l.total > 1 ? "s" : ""}</span>
              {l.taux !== null && <span style={{ color: "#1a7a3c", fontWeight: 600 }}>{l.taux}% réussite</span>}
            </div>
            {(l.montantRecupere > 0 || l.montantPerdu > 0) && (
              <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 12.5 }}>
                <span style={{ color: "#1F9D6E" }}>+{formatFCFA(l.montantRecupere)} récupéré</span>
                {l.montantPerdu > 0 && <span style={{ color: "#D64933" }}>-{formatFCFA(l.montantPerdu)} perdu</span>}
              </div>
            )}
            {l.montantDu > 0 && (
              <div style={{ marginTop: 10, background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 8, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#8A6412", fontWeight: 600 }}>💵 Sa commission</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, color: "#8A6412" }}>{formatFCFA(l.montantDu)}</span>
              </div>
            )}
            {l.montantADeposer > 0 && (
              <div style={{ marginTop: 6, background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 8, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#3B6D11", fontWeight: 600 }}>🏦 Doit déposer</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, color: "#3B6D11" }}>{formatFCFA(l.montantADeposer)}</span>
              </div>
            )}
            <DetailProduitsLivreur produitsDetail={l.produitsDetail} />
          </div>
        ))}
      </div>
    </div>
  );
}

function total_ok(l) {
  return l.total > 0;
}

function DetailProduitsLivreur({ produitsDetail }) {
  const [open, setOpen] = useState(false);
  if (!produitsDetail || produitsDetail.length === 0) return null;

  const totalRestant = produitsDetail.reduce((s, p) => s + p.restants, 0);

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: "100%", background: "none", border: "1px solid #ECE8DC", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "#16231F", display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span>📦 Détail par produit ({produitsDetail.length})</span>
        <span style={{ color: totalRestant > 0 ? "#D64933" : "#8A9089" }}>
          {totalRestant > 0 ? `${totalRestant} restant${totalRestant > 1 ? "s" : ""}` : "tout livré"} {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          {produitsDetail.map((p) => (
            <div key={p.nom} style={{ background: "#FAFAF7", borderRadius: 7, padding: "7px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{p.nom}</span>
              <div style={{ display: "flex", gap: 10, fontSize: 11.5 }}>
                <span style={{ color: "#8A9089" }}>{p.assignes} assignés</span>
                <span style={{ color: "#1F9D6E" }}>{p.livres} livrés</span>
                <span style={{ color: p.restants > 0 ? "#D64933" : "#8A9089", fontWeight: 600 }}>{p.restants} restants</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddLivreur({ onClose, onAdd }) {
  const [form, setForm] = useState({ nom: "", telephone: "", zone: "", email: "" });
  const canSubmit = form.nom && form.telephone;

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Nouveau livreur</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        {["nom", "telephone", "zone"].map((field) => (
          <div key={field} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4, textTransform: "capitalize" }}>
              {field === "telephone" ? "Téléphone" : field}
            </label>
            <input
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
            />
          </div>
        ))}

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>
            Email de connexion (optionnel)
          </label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="pour lui donner un accès restreint à ses commandes"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
          />
          <div style={{ fontSize: 11, color: "#8A9089", marginTop: 4 }}>
            Si renseigné (et un compte créé via "Inviter"), ce livreur ne verra que ses propres commandes en se connectant.
          </div>
        </div>

        <button
          disabled={!canSubmit}
          onClick={() => canSubmit && onAdd(form)}
          style={{ width: "100%", marginTop: 6, padding: "13px 0", borderRadius: 10, border: "none", background: canSubmit ? "#1a7a3c" : "#DDD8CC", color: "white", fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Check size={17} /> Ajouter le livreur
        </button>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setErrorMsg("");
    if (!email || !password) {
      setErrorMsg("Remplis email et mot de passe.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErrorMsg(error.message === "Invalid login credentials" ? "Email ou mot de passe incorrect." : error.message);
    setLoading(false);
  }

  return (
    <div style={{ background: "#FAFAF7", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Sans', sans-serif", padding: 20 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');`}</style>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, marginBottom: 28 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "#1a7a3c", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="17" height="17" viewBox="0 0 100 100">
              <polyline points="15,62 40,42 55,56 85,28" stroke="#e8920a" strokeWidth="11" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22 }}>
            RECU<span style={{ color: "#e8920a" }}>VENTE</span>
          </div>
        </div>

        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 16, padding: 26 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 18, marginBottom: 4 }}>
            Connexion
          </div>
          <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 20 }}>
            Accède à ton espace Azali Express. Réservé aux comptes créés par l'administrateur.
          </div>

          <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, marginBottom: 14 }}
          />

          <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Mot de passe</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, marginBottom: 16 }}
          />

          {errorMsg && <div style={{ background: "#FBEAE6", color: "#D64933", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, marginBottom: 12 }}>{errorMsg}</div>}

          <button
            onClick={submit}
            disabled={loading}
            style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "#1a7a3c", color: "white", fontWeight: 700, fontSize: 14.5, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "..." : "Se connecter"}
          </button>

          <div style={{ fontSize: 11.5, color: "#8A9089", textAlign: "center", marginTop: 14 }}>
            Pas de compte ? Demande à ton administrateur de t'en créer un.
          </div>
        </div>
      </div>
    </div>
  );
}

function InviteModal({ onClose }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit() {
    setErrorMsg("");
    if (!email || !password) {
      setErrorMsg("Remplis email et mot de passe.");
      return;
    }
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/invite-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token}` },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || "Erreur lors de la création du compte.");
      } else {
        setSuccess(true);
      }
    } catch (e) {
      setErrorMsg("Erreur réseau: " + e.message);
    }
    setLoading(false);
  }

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Inviter quelqu'un</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        {success ? (
          <div>
            <div style={{ background: "#EAF3DE", color: "#3B6D11", fontSize: 13.5, padding: "14px", borderRadius: 10, marginBottom: 16 }}>
              ✅ Compte créé pour <strong>{email}</strong>.<br />Communique-lui l'email et le mot de passe pour qu'il se connecte sur recuvente.vercel.app.
            </div>
            <button
              onClick={onClose}
              style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "#1a7a3c", color: "white", fontWeight: 600, fontSize: 14.5 }}
            >
              Fermer
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 16 }}>
              Crée un compte pour un membre de ton équipe (closer, etc.). Donne-lui ensuite l'email et le mot de passe.
            </div>

            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, marginBottom: 12 }}
            />

            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Mot de passe temporaire</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Au moins 6 caractères"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, marginBottom: 14 }}
            />

            {errorMsg && <div style={{ background: "#FBEAE6", color: "#D64933", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, marginBottom: 12 }}>{errorMsg}</div>}

            <button
              onClick={submit}
              disabled={loading}
              style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "none", background: "#1a7a3c", color: "white", fontWeight: 600, fontSize: 14.5, opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "Création..." : "Créer le compte"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TeamModal({ onClose, currentUserId }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  async function loadUsers() {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/team", {
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Erreur de chargement");
      } else {
        setUsers(json.users);
      }
    } catch (e) {
      setError("Erreur réseau: " + e.message);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function removeUser(id) {
    setDeletingId(id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch("/api/team", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session?.access_token}` },
        body: JSON.stringify({ userId: id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Erreur lors de la suppression");
      } else {
        setUsers((prev) => prev.filter((u) => u.id !== id));
      }
    } catch (e) {
      setError("Erreur réseau: " + e.message);
    }
    setDeletingId(null);
    setConfirmId(null);
  }

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxHeight: "80vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Équipe</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        {error && <div style={{ background: "#FBEAE6", color: "#D64933", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, marginBottom: 12 }}>{error}</div>}

        {users === null && !error && <div style={{ textAlign: "center", padding: "30px 0", color: "#8A9089", fontSize: 14 }}>Chargement...</div>}

        {users && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {users.map((u) => (
              <div key={u.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {u.email} {u.id === currentUserId && <span style={{ fontSize: 11, color: "#1a7a3c", fontWeight: 600 }}>(toi)</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#8A9089", marginTop: 2 }}>
                    {u.last_sign_in_at ? "Dernière connexion : " + new Date(u.last_sign_in_at).toLocaleDateString("fr-FR") : "Jamais connecté"}
                  </div>
                </div>
                {u.id !== currentUserId && (
                  confirmId === u.id ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => removeUser(u.id)}
                        disabled={deletingId === u.id}
                        style={{ background: "#D64933", color: "white", border: "none", borderRadius: 7, padding: "6px 10px", fontSize: 11.5, fontWeight: 600 }}
                      >
                        {deletingId === u.id ? "..." : "Confirmer"}
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        style={{ background: "white", border: "1px solid #DDD8CC", borderRadius: 7, padding: "6px 10px", fontSize: 11.5 }}
                      >
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmId(u.id)} style={{ background: "none", border: "none", color: "#D64933", padding: 6 }} aria-label="Retirer">
                      <Trash2 size={16} />
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RelancesHistorique({ orderId, onAdded }) {
  const [relances, setRelances] = useState([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from("relances")
      .select("*")
      .eq("commande_id", orderId)
      .order("created_at", { ascending: false });
    if (!error) setRelances(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [orderId]);

  async function addNote() {
    if (!note.trim()) return;
    setAdding(true);
    const { error } = await supabase.from("relances").insert([{ commande_id: orderId, note: note.trim() }]);
    if (!error) {
      setNote("");
      await load();
      if (onAdded) onAdded();
    }
    setAdding(false);
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
        Historique des relances {relances.length > 0 && `(${relances.length})`}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addNote()}
          placeholder="Ex: Appelé, pas de réponse"
          style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }}
        />
        <button
          onClick={addNote}
          disabled={adding || !note.trim()}
          style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 8, padding: "0 14px", fontSize: 13, fontWeight: 600 }}
        >
          Ajouter
        </button>
      </div>

      {!loading && relances.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {relances.map((r) => (
            <div key={r.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 13 }}>{r.note}</div>
              <div style={{ fontSize: 10.5, color: "#8A9089", marginTop: 2 }}>
                {new Date(r.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TodayView({ todo, onSelectOrder, onRelancerTout, clientsARelancer = [], monProfilCloser, commandesNonAssigneesListe = [], onSeAttribuer, enAttenteDepot = [] }) {
  const sections = [
    { key: "aRelivrer", title: "📅 À relivrer aujourd'hui", items: todo.aRelivrer, color: "#1a7a3c", bg: "#EAF3DE" },
    { key: "jamaisContactees", title: "🆕 Jamais contactées", items: todo.jamaisContactees, color: "#8A6412", bg: "#FBF3E3" },
    { key: "sansNouvelles", title: "⏰ Sans nouvelles depuis 24h+", items: todo.sansNouvelles, color: "#D64933", bg: "#FBEAE6" },
  ];

  return (
    <div style={{ padding: "20px 20px 8px" }}>
      {monProfilCloser && commandesNonAssigneesListe.length > 0 && (
        <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 14, padding: "14px 16px", marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "#8A6412", marginBottom: 2 }}>
            🆓 Non assignées — à prendre ({commandesNonAssigneesListe.length})
          </div>
          <div style={{ fontSize: 12, color: "#8A6412", marginBottom: 10 }}>
            Personne n'a encore pris ces commandes. Une fois prise, elle disparaît pour les autres closers.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {commandesNonAssigneesListe.slice(0, 8).map((o) => (
              <div key={o.id} style={{ background: "white", borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.client}</div>
                  <div style={{ fontSize: 11.5, color: "#6B7168" }}>{o.produit} · {formatFCFA(o.montant)}</div>
                </div>
                <button
                  onClick={() => onSeAttribuer(o.id, monProfilCloser.nom)}
                  style={{ flexShrink: 0, background: "#e8920a", color: "white", border: "none", borderRadius: 8, padding: "8px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                >
                  Je la prends
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {enAttenteDepot.length > 0 && (
        <div style={{ background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 14, padding: "14px 16px", marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "#B23A22", marginBottom: 2 }}>
            📦 Expéditions en attente de dépôt ({enAttenteDepot.length})
          </div>
          <div style={{ fontSize: 12, color: "#B23A22", marginBottom: 10 }}>
            Ces colis ne peuvent pas partir tant que le dépôt n'est pas reçu.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {enAttenteDepot.slice(0, 8).map((o) => (
              <div key={o.id} onClick={() => onSelectOrder(o)} style={{ background: "white", borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{o.client}</div>
                <div style={{ fontSize: 11.5, color: "#6B7168" }}>{o.produit} · {formatFCFA(o.montant + (o.frais_expedition || 0))} à collecter</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, marginBottom: 4 }}>Aujourd'hui</div>
          <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 14 }}>
            {todo.total > 0 ? `${todo.total} commande${todo.total > 1 ? "s" : ""} à traiter` : "Rien à traiter, tout est à jour ✅"}
          </div>
        </div>
        {todo.total > 0 && (
          <button
            onClick={onRelancerTout}
            style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}
          >
            Relancer tout
          </button>
        )}
      </div>

      {(todo.argentARisque > 0 || todo.argentRecuperable > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          <div style={{ background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, color: "#B23A22", textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 600 }}>💸 Argent à risque</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, marginTop: 3, color: "#D64933" }}>{formatFCFA(todo.argentARisque)}</div>
          </div>
          <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 10.5, color: "#8A6412", textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 600 }}>♻️ Récupérable</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, marginTop: 3, color: "#8A6412" }}>{formatFCFA(todo.argentRecuperable)}</div>
          </div>
        </div>
      )}

      {todo.total === 0 && (
        <div style={{ textAlign: "center", padding: "50px 20px", color: "#8A9089" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
          <div style={{ fontSize: 14 }}>Aucune commande urgente pour le moment.</div>
        </div>
      )}

      {sections.map((sec) => {
        const montant = sec.items.reduce((s, o) => s + Number(o.montant), 0);
        return sec.items.length > 0 ? (
          <div key={sec.key} style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: sec.color }}>
                {sec.title} ({sec.items.length})
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: sec.color }}>
                {formatFCFA(montant)}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sec.items.map((o, oi) => (
                <button
                  key={o.id}
                  onClick={() => onSelectOrder(o)}
                  style={{ textAlign: "left", background: "white", border: "1px solid #ECE8DC", borderLeft: `4px solid ${sec.color}`, borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}
                >
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: oi === 0 ? sec.color : "#ECE8DC", color: oi === 0 ? "white" : "#8A9089", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {oi + 1}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", gap: 6 }}>
                      {o.client}
                      {oi === 0 && <span style={{ fontSize: 10, fontWeight: 700, color: sec.color, background: sec.bg, padding: "1px 7px", borderRadius: 999 }}>🔥 PRIORITÉ</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{o.produit} · {o.tel}</div>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 14.5, flexShrink: 0 }}>{formatFCFA(o.montant)}</div>
                </button>
              ))}
            </div>
          </div>
        ) : null;
      })}

      {clientsARelancer.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a7a3c", marginBottom: 3 }}>
            🔄 Clients à relancer pour réachat ({clientsARelancer.length})
          </div>
          <div style={{ fontSize: 11.5, color: "#8A9089", marginBottom: 8 }}>
            Basé sur leur rythme d'achat habituel — leur prochaine commande est probablement en retard.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {clientsARelancer.slice(0, 10).map((c) => (
              <a
                key={c.tel}
                href={`https://wa.me/${cleanPhoneForWhatsApp(c.tel)}?text=${encodeURIComponent(`Bonjour ${c.nom.split(" ")[0]} 👋, ça faisait un moment ! On voulait savoir si vous seriez intéressé(e) pour recommander ${c.produitPrefere || "un de nos produits"} chez Azali Express ?`)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textAlign: "left", background: "white", border: "1px solid #ECE8DC", borderLeft: "4px solid #1a7a3c", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{c.nom}</div>
                  <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>
                    Achète en général tous les {c.intervalleMoyen}j · dernier achat il y a {c.joursDepuisDernier}j
                  </div>
                  {c.produitPrefere && (
                    <div style={{ fontSize: 11.5, color: "#8A9089", marginTop: 2 }}>Préfère : {c.produitPrefere}</div>
                  )}
                </div>
                <div style={{ background: "#1F9D6E", borderRadius: 8, padding: 8, display: "flex", flexShrink: 0 }}>
                  <MessageCircle size={16} color="white" />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ValidationsView({ orders, onSelectOrder }) {
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
    const confirmeesAvecDate = orders.filter((o) => {
      if (o.statut !== "confirmee" || !o.confirmed_at) return false;
      const d = new Date(o.confirmed_at);
      return d >= dateRange.start && d < dateRange.end;
    });
    const map = {};
    confirmeesAvecDate.forEach((o) => {
      const dValidation = new Date(o.confirmed_at);
      const keyValidation = dValidation.toISOString().slice(0, 10);
      const dCreation = new Date(o.created_at);
      const keyCreation = dCreation.toISOString().slice(0, 10);
      const memeJour = keyValidation === keyCreation;
      if (!map[keyValidation]) {
        map[keyValidation] = {
          date: keyValidation,
          label: dValidation.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
          orders: [],
        };
      }
      map[keyValidation].orders.push({ ...o, memeJour, labelCreation: dCreation.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) });
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [orders, dateRange]);

  const nonValideesParJour = useMemo(() => {
    const nonValidees = orders.filter((o) => {
      if (o.statut !== "en_cours" && o.statut !== "echouee") return false;
      const d = new Date(o.created_at);
      return d >= dateRange.start && d < dateRange.end;
    });
    const map = {};
    nonValidees.forEach((o) => {
      const d = new Date(o.created_at);
      const key = d.toISOString().slice(0, 10);
      if (!map[key]) {
        map[key] = { date: key, label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), orders: [] };
      }
      map[key].orders.push(o);
    });
    return Object.values(map).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [orders, dateRange]);

  return (
    <div style={{ padding: "20px 20px 8px" }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, marginBottom: 4 }}>Validations</div>
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
            style={{ padding: "6px 13px", borderRadius: 999, border: `1px solid ${datePreset === d.key ? "#1a7a3c" : "#DDD8CC"}`, background: datePreset === d.key ? "#1a7a3c" : "white", color: datePreset === d.key ? "white" : "#16231F", fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0 }}
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
          style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${tab === "validees" ? "#1a7a3c" : "#DDD8CC"}`, background: tab === "validees" ? "#1a7a3c" : "white", color: tab === "validees" ? "white" : "#16231F", fontWeight: 600, fontSize: 13 }}
        >
          ✅ Validées ({validationsParJour.reduce((s, g) => s + g.orders.length, 0)})
        </button>
        <button
          onClick={() => setTab("nonvalidees")}
          style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${tab === "nonvalidees" ? "#D64933" : "#DDD8CC"}`, background: tab === "nonvalidees" ? "#D64933" : "white", color: tab === "nonvalidees" ? "white" : "#16231F", fontWeight: 600, fontSize: 13 }}
        >
          ⏳ Non validées ({nonValideesParJour.reduce((s, g) => s + g.orders.length, 0)})
        </button>
      </div>

      {tab === "validees" && (
        <>
          {validationsParJour.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#8A9089" }}>
              <div style={{ fontSize: 14 }}>Aucune validation enregistrée pour l'instant.</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>Les nouvelles confirmations apparaîtront ici automatiquement.</div>
            </div>
          )}
          {validationsParJour.map((group) => (
            <div key={group.date} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1a7a3c", textTransform: "capitalize", marginBottom: 8 }}>
                Validé {group.label} ({group.orders.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {group.orders.map((o) => (
                  <div key={o.id} onClick={() => onSelectOrder(o)} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 10, padding: "12px 14px", cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{o.client}</div>
                        <div style={{ fontSize: 12, color: "#6B7168" }}>{o.produit}</div>
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 14 }}>{formatFCFA(o.montant)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                      {!o.memeJour && (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#8A6412", background: "#FBF3E3", padding: "2px 8px", borderRadius: 999 }}>
                          📅 commandée le {o.labelCreation}
                        </span>
                      )}
                      {o.confirmed_by && (
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: "#1a7a3c", background: "#EAF3DE", padding: "2px 8px", borderRadius: 999 }}>
                          ✅ validé par {o.confirmed_by}
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
                {group.orders.map((o) => (
                  <div key={o.id} onClick={() => onSelectOrder(o)} style={{ background: "white", border: "1px solid #ECE8DC", borderLeft: `4px solid ${o.statut === "echouee" ? "#D64933" : "#E8A93D"}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{o.client}</div>
                        <div style={{ fontSize: 12, color: "#6B7168" }}>{o.produit} · {o.statut === "echouee" ? "Échouée" : "En cours"}</div>
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 14 }}>{formatFCFA(o.montant)}</div>
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

function BatchRelanceModal({ orders, onClose, onLog }) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState([]);
  const current = orders[index];

  function next() {
    if (index < orders.length - 1) setIndex(index + 1);
    else setIndex(orders.length);
  }

  async function sendAndLog(type) {
    if (type === "whatsapp") {
      window.open(waLink(current), "_blank");
      await onLog(current.id, "Relance groupée envoyée (WhatsApp)");
    } else {
      window.location.href = `sms:${current.tel}?body=${encodeURIComponent(smsMsg(current))}`;
      await onLog(current.id, "Relance groupée envoyée (SMS)");
    }
    setDone((d) => [...d, current.id]);
  }

  const finished = index >= orders.length;

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#FAFAF7", width: "100%", maxWidth: 380, borderRadius: 18, padding: "20px 20px 24px" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 18 }}>Relance groupée</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        {!finished ? (
          <>
            <div style={{ fontSize: 12, color: "#8A9089", marginBottom: 14 }}>
              {index + 1} / {orders.length} — {done.length} déjà contacté{done.length > 1 ? "s" : ""}
            </div>
            <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{current.client}</div>
              <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{current.tel} · {current.produit}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 15, marginTop: 6, color: "#1a7a3c" }}>{formatFCFA(current.montant)}</div>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => sendAndLog("whatsapp")}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#1F9D6E", color: "white", border: "none", padding: "11px 0", borderRadius: 10, fontWeight: 600, fontSize: 13.5 }}
              >
                <MessageCircle size={16} /> WhatsApp
              </button>
              <button
                onClick={() => sendAndLog("sms")}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#1a7a3c", color: "white", border: "none", padding: "11px 0", borderRadius: 10, fontWeight: 600, fontSize: 13.5 }}
              >
                <MessageSquare size={16} /> SMS
              </button>
            </div>

            <button
              onClick={next}
              style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "1px solid #DDD8CC", background: "white", color: "#16231F", fontWeight: 600, fontSize: 13.5 }}
            >
              {index < orders.length - 1 ? "Suivant →" : "Terminer"}
            </button>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{done.length} relance{done.length > 1 ? "s" : ""} envoyée{done.length > 1 ? "s" : ""}</div>
            <div style={{ fontSize: 12.5, color: "#6B7168", marginBottom: 18 }}>sur {orders.length} commandes de la liste</div>
            <button
              onClick={onClose}
              style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "#1a7a3c", color: "white", fontWeight: 600, fontSize: 14 }}
            >
              Fermer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CampagneModal({ clients, onClose }) {
  const [segment, setSegment] = useState("tous");
  const [segmentProduit, setSegmentProduit] = useState("");
  const [message, setMessage] = useState("");
  const [productLink, setProductLink] = useState("");
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [sentCount, setSentCount] = useState(0);

  const PRODUITS_RAPIDES = [
    { nom: "Peineili Spray", url: "https://www.azaliexpress.com/products/peineili-spray" },
    { nom: "Dongyitang", url: "https://www.azaliexpress.com/products/zalidongyitangbaumechauffantarticulations" },
    { nom: "Azali Tisane", url: "https://www.azaliexpress.com/products/azali" },
    { nom: "Tampons Éclat", url: "https://www.azaliexpress.com/products/tampons-nettoyants" },
    { nom: "AirFlow", url: "https://www.azaliexpress.com/products/azali-airflow-1" },
  ];

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

  function send(type) {
    const text = personalize(message, current.nom);
    if (type === "whatsapp") {
      window.open(`https://wa.me/${cleanPhoneForWhatsApp(current.tel)}?text=${encodeURIComponent(text)}`, "_blank");
    } else {
      window.location.href = `sms:${current.tel}?body=${encodeURIComponent(text)}`;
    }
    setSentCount((c) => c + 1);
  }

  function next() {
    setIndex((i) => i + 1);
  }

  const finished = started && index >= clientsSegmentes.length;

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxWidth: 400, maxHeight: "85vh", overflowY: "auto", borderRadius: 18, padding: "20px 20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 18 }}>Campagne promo</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
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
                    textAlign: "left",
                    padding: "9px 12px",
                    borderRadius: 9,
                    border: "1px solid " + (segment === s.key ? "#1a7a3c" : "#DDD8CC"),
                    background: segment === s.key ? "#EAF3DE" : "white",
                    color: segment === s.key ? "#1a7a3c" : "#16231F",
                    fontSize: 13,
                    fontWeight: segment === s.key ? 600 : 500,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {segment === "produit" && (
              <select
                value={segmentProduit}
                onChange={(e) => setSegmentProduit(e.target.value)}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid #DDD8CC", fontSize: 13, marginBottom: 14, background: "white" }}
              >
                <option value="">Choisir un produit...</option>
                {produitsAchetes.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            )}

            <div style={{ fontSize: 12.5, color: "#6B7168", marginBottom: 12 }}>
              Écris ton message une fois. Utilise <strong>{"{prenom}"}</strong> pour insérer automatiquement le prénom de chaque client. Il sera envoyé à <strong>{clientsSegmentes.length} client{clientsSegmentes.length > 1 ? "s" : ""}</strong> un par un.
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="Ex: Bonjour {prenom} 👋, nouvelle promo chez Azali Express cette semaine : -20% sur tous les produits ! Réponds pour en profiter."
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #DDD8CC", fontSize: 13.5, marginBottom: 14, resize: "vertical" }}
            />

            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 6 }}>Lien du produit (optionnel — WhatsApp affichera l'image automatiquement)</label>
            <input
              type="text"
              value={productLink}
              onChange={(e) => setProductLink(e.target.value)}
              placeholder="https://www.azaliexpress.com/products/..."
              style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid #DDD8CC", fontSize: 13, marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {PRODUITS_RAPIDES.map((p) => (
                <button
                  key={p.url}
                  onClick={() => setProductLink(p.url)}
                  style={{ fontSize: 11, padding: "5px 10px", borderRadius: 999, border: "1px solid " + (productLink === p.url ? "#1a7a3c" : "#DDD8CC"), background: productLink === p.url ? "#EAF3DE" : "white", color: productLink === p.url ? "#1a7a3c" : "#6B7168", fontWeight: 500 }}
                >
                  {p.nom}
                </button>
              ))}
            </div>

            <button
              onClick={() => setStarted(true)}
              disabled={!message.trim() || clientsSegmentes.length === 0 || (segment === "produit" && !segmentProduit)}
              style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: message.trim() ? "#1a7a3c" : "#DDD8CC", color: "white", fontWeight: 700, fontSize: 14 }}
            >
              Démarrer l'envoi
            </button>
          </>
        )}

        {started && !finished && current && (
          <>
            <div style={{ fontSize: 12, color: "#8A9089", marginBottom: 14 }}>
              {index + 1} / {clientsSegmentes.length} — {sentCount} envoyé{sentCount > 1 ? "s" : ""}
            </div>
            <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{current.nom}</div>
              <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{current.tel}</div>
              <div style={{ fontSize: 13, marginTop: 10, background: "#FAFAF7", padding: 10, borderRadius: 8, color: "#16231F" }}>
                {personalize(message, current.nom)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => send("whatsapp")}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#1F9D6E", color: "white", border: "none", padding: "11px 0", borderRadius: 10, fontWeight: 600, fontSize: 13.5 }}
              >
                <MessageCircle size={16} /> WhatsApp
              </button>
              <button
                onClick={() => send("sms")}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#1a7a3c", color: "white", border: "none", padding: "11px 0", borderRadius: 10, fontWeight: 600, fontSize: 13.5 }}
              >
                <MessageSquare size={16} /> SMS
              </button>
            </div>
            <button
              onClick={next}
              style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "1px solid #DDD8CC", background: "white", color: "#16231F", fontWeight: 600, fontSize: 13.5 }}
            >
              {index < clientsSegmentes.length - 1 ? "Suivant →" : "Terminer"}
            </button>
          </>
        )}

        {finished && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📣</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{sentCount} message{sentCount > 1 ? "s" : ""} envoyé{sentCount > 1 ? "s" : ""}</div>
            <div style={{ fontSize: 12.5, color: "#6B7168", marginBottom: 18 }}>sur {clientsSegmentes.length} clients</div>
            <button
              onClick={onClose}
              style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "#1a7a3c", color: "white", fontWeight: 600, fontSize: 14 }}
            >
              Fermer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CelebrationOverlay({ montant, client }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), 2000);
    return () => clearTimeout(t);
  }, []);

  const confettiColors = ["#e8920a", "#1F9D6E", "#1a7a3c", "#f0b94a"];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      <div
        className={leaving ? "rv-celebrate-out" : "rv-celebrate-in"}
        style={{
          background: "#16231F",
          borderRadius: 20,
          padding: "28px 36px",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          position: "relative",
          overflow: "visible",
        }}
      >
        <div style={{ position: "absolute", top: -6, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
          {confettiColors.map((c, i) => (
            <span
              key={i}
              className="rv-confetti"
              style={{
                width: 6,
                height: 6,
                borderRadius: i % 2 === 0 ? "50%" : 2,
                background: c,
                display: "inline-block",
                animationDelay: `${i * 0.06}s`,
              }}
            />
          ))}
        </div>

        <div style={{ fontSize: 32, marginBottom: 6 }}>🎉</div>
        <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 12.5, marginBottom: 4 }}>
          Vente récupérée{client ? ` — ${client.split(" ")[0]}` : ""}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 34, color: "#e8920a" }}>
          +{formatFCFA(montant)}
        </div>
      </div>
    </div>
  );
}

function ClosersView({ closers, onDelete, nonAssignees, periodLabel }) {
  const maxTaux = Math.max(...closers.map((c) => c.taux ?? 0), 1);

  return (
    <div style={{ padding: "20px 20px 8px" }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, marginBottom: 4 }}>Closers</div>
      <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 4 }}>{closers.length} closer{closers.length > 1 ? "s" : ""} · classés par taux de confirmation</div>
      {periodLabel && (
        <div style={{ display: "inline-block", fontSize: 11, fontWeight: 600, color: "#1a7a3c", background: "#EAF3DE", padding: "3px 10px", borderRadius: 999, marginBottom: 14 }}>
          📊 {periodLabel}
        </div>
      )}

      {nonAssignees > 0 && (
        <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: 12.5, color: "#8A6412", fontWeight: 600 }}>
          ⚠️ {nonAssignees} commande{nonAssignees > 1 ? "s" : ""} active{nonAssignees > 1 ? "s" : ""} non assignée{nonAssignees > 1 ? "s" : ""} à un closer
        </div>
      )}

      {closers.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#8A9089", fontSize: 14 }}>Aucun closer ajouté. Appuie sur "+" pour en ajouter un.</div>
      )}

      {closers.length > 1 && (
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "16px 16px 10px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 12 }}>Comparatif — taux de confirmation</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {closers.map((c) => (
              <div key={c.id}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
                  <span>{c.nom}</span>
                  <span style={{ fontWeight: 600 }}>{c.taux !== null ? c.taux + "%" : "—"}</span>
                </div>
                <div style={{ background: "#ECE8DC", borderRadius: 999, height: 7, overflow: "hidden" }}>
                  <div style={{ width: `${((c.taux ?? 0) / maxTaux) * 100}%`, background: "#1a7a3c", height: "100%", borderRadius: 999 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {closers.map((c) => (
          <div key={c.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{c.nom}</div>
                <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{c.telephone}</div>
              </div>
              <button onClick={() => onDelete(c.id)} style={{ background: "none", border: "none", color: "#D64933", padding: 6 }} aria-label="Retirer">
                <Trash2 size={17} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12.5, flexWrap: "wrap" }}>
              <span style={{ color: "#6B7168" }}>{c.total} commande{c.total > 1 ? "s" : ""}</span>
              <span style={{ color: "#1a7a3c", fontWeight: 700 }}>✅ {c.confirmees} confirmée{c.confirmees > 1 ? "s" : ""}</span>
              {c.taux !== null && <span style={{ color: "#8A9089" }}>({c.taux}%)</span>}
              {c.enCours > 0 && <span style={{ color: "#8A6412" }}>{c.enCours} en cours</span>}
            </div>
            {c.montantRecupere > 0 && (
              <div style={{ marginTop: 6, fontSize: 12.5, color: "#1F9D6E" }}>+{formatFCFA(c.montantRecupere)} récupéré</div>
            )}
            <DetailProduitsLivreur produitsDetail={c.produitsDetail} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AddCloser({ onClose, onAdd }) {
  const [form, setForm] = useState({ nom: "", telephone: "", email: "" });
  const canSubmit = form.nom;

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Nouveau closer</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        {["nom", "telephone"].map((field) => (
          <div key={field} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4, textTransform: "capitalize" }}>
              {field === "telephone" ? "Téléphone (optionnel)" : field}
            </label>
            <input
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
            />
          </div>
        ))}

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>
            Email de connexion (optionnel)
          </label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="pour lui donner accès uniquement à ses commandes"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
          />
          <div style={{ fontSize: 11, color: "#8A9089", marginTop: 4 }}>
            Si renseigné (et un compte créé via "Inviter"), ce closer verra uniquement ses commandes, avec relance/appel/SMS, sans pouvoir s'auto-attribuer d'autres commandes.
          </div>
        </div>

        <button
          disabled={!canSubmit}
          onClick={() => canSubmit && onAdd(form)}
          style={{ width: "100%", marginTop: 6, padding: "13px 0", borderRadius: 10, border: "none", background: canSubmit ? "#1a7a3c" : "#DDD8CC", color: "white", fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Check size={17} /> Ajouter le closer
        </button>
      </div>
    </div>
  );
}

function LivreurPortal({ livreur, orders, onStatus, toast }) {
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

  const activesToutes = orders.filter((o) => o.statut === "en_cours" || o.statut === "echouee");
  const actives = activesToutes.filter((o) => {
    const d = new Date(o.created_at);
    return d >= dateRange.start && d < dateRange.end;
  });
  const actives_livraison = actives.filter((o) => o.type_livraison !== "expedition");
  const actives_expedition = actives.filter((o) => o.type_livraison === "expedition");
  const confirmees = orders.filter((o) => o.statut === "confirmee");
  const [ongletActif, setOngletActif] = useState("livraison");
  const [envoiPhotoId, setEnvoiPhotoId] = useState(null);

  async function confirmerExpedition(orderId, fichierPhoto) {
    if (!fichierPhoto) return;
    if (fichierPhoto.size > 5 * 1024 * 1024) {
      alert("La photo est trop lourde (max 5 Mo). Choisis une photo plus légère.");
      return;
    }

    setEnvoiPhotoId(orderId);
    const extension = fichierPhoto.name.split(".").pop();
    const chemin = `${orderId}-${Date.now()}.${extension}`;
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
    }).eq("id", orderId);
    await supabase.from("relances").insert([{ commande_id: orderId, note: `📦 Expédition confirmée par ${livreur.nom}, reçu photographié` }]);
    setEnvoiPhotoId(null);
  }

  const produitsDetail = useMemo(() => {
    const map = {};
    orders.forEach((o) => {
      const { nom, quantite } = parseProduitTexte(o.produit);
      if (!nom) return;
      if (!map[nom]) map[nom] = { nom, assignes: 0, livres: 0, restants: 0 };
      map[nom].assignes += quantite;
      if (o.statut === "confirmee") map[nom].livres += quantite;
      else map[nom].restants += quantite;
    });
    return Object.values(map).sort((a, b) => b.assignes - a.assignes);
  }, [orders]);

  const bilanParJour = useMemo(() => {
    const map = {};
    confirmees.forEach((o) => {
      const d = new Date(o.created_at);
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

  const [enTournee, setEnTournee] = useState(!!livreur.en_tournee);
  const [gpsErreur, setGpsErreur] = useState(null);
  const watchIdRef = useRef(null);

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
        if (err.code === err.PERMISSION_DENIED) {
          setGpsErreur("Autorisation de localisation refusée. Active-la dans les réglages de ton téléphone pour démarrer ta tournée.");
        } else {
          setGpsErreur("Impossible d'obtenir ta position pour le moment.");
        }
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

  return (
    <div style={{ background: "#FAFAF7", minHeight: "100vh", fontFamily: "'IBM Plex Sans', sans-serif", color: "#16231F" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');`}</style>

      <div style={{ background: "#1a7a3c", color: "white", padding: "24px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="15" height="15" viewBox="0 0 100 100">
              <polyline points="15,62 40,42 55,56 85,28" stroke="#e8920a" strokeWidth="11" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 17 }}>
            RECU<span style={{ color: "#e8920a" }}>VENTE</span>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ marginLeft: "auto", background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 500 }}
          >
            Déconnexion
          </button>
        </div>
        <div style={{ fontSize: 13, opacity: 0.8 }}>Bonjour</div>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22 }}>{livreur.nom}</div>

        <button
          onClick={enTournee ? terminerTournee : demarrerTournee}
          style={{
            width: "100%",
            marginTop: 14,
            padding: "13px 0",
            borderRadius: 10,
            border: "none",
            background: enTournee ? "#D64933" : "#e8920a",
            color: "white",
            fontWeight: 700,
            fontSize: 14.5,
          }}
        >
          {enTournee ? "🔴 Terminer ma tournée" : "🟢 Démarrer ma tournée"}
        </button>
        {enTournee && (
          <div style={{ fontSize: 11.5, opacity: 0.8, marginTop: 6, textAlign: "center" }}>
            📍 Ta position est partagée avec l'administrateur pendant ta tournée
          </div>
        )}
        {gpsErreur && (
          <div style={{ background: "rgba(214,73,51,0.2)", borderRadius: 8, padding: "8px 10px", marginTop: 8, fontSize: 12 }}>
            {gpsErreur}
          </div>
        )}

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
          <div style={{ fontSize: 11, opacity: 0.85 }}>💰 Mes gains ({confirmees.length} × 1 500 F)</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 22, color: "#e8920a", marginTop: 2 }}>
            {formatFCFA(confirmees.length * 1500)}
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
                    {j.livrees} livrée{j.livrees > 1 ? "s" : ""} · {formatFCFA(j.gains)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: "18px 20px" }}>
        {produitsDetail.length > 0 && (
          <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>📦 Mes produits à livrer</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {produitsDetail.map((p) => (
                <div key={p.nom} style={{ background: "#FAFAF7", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{p.nom}</span>
                  <div style={{ display: "flex", gap: 10, fontSize: 11.5 }}>
                    <span style={{ color: "#8A9089" }}>{p.assignes} au total</span>
                    <span style={{ color: "#1F9D6E" }}>{p.livres} livrés</span>
                    <span style={{ color: p.restants > 0 ? "#D64933" : "#8A9089", fontWeight: 600 }}>{p.restants} restants</span>
                  </div>
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
              style={{ padding: "6px 13px", borderRadius: 999, border: `1px solid ${datePreset === d.key ? "#1a7a3c" : "#DDD8CC"}`, background: datePreset === d.key ? "#1a7a3c" : "white", color: datePreset === d.key ? "white" : "#16231F", fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0 }}
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

        {actives_expedition.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              onClick={() => setOngletActif("livraison")}
              style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${ongletActif === "livraison" ? "#1a7a3c" : "#DDD8CC"}`, background: ongletActif === "livraison" ? "#1a7a3c" : "white", color: ongletActif === "livraison" ? "white" : "#16231F", fontWeight: 600, fontSize: 13 }}
            >
              🏍️ Abidjan ({actives_livraison.length})
            </button>
            <button
              onClick={() => setOngletActif("expedition")}
              style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: `1px solid ${ongletActif === "expedition" ? "#2452E8" : "#DDD8CC"}`, background: ongletActif === "expedition" ? "#2452E8" : "white", color: ongletActif === "expedition" ? "white" : "#16231F", fontWeight: 600, fontSize: 13 }}
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
            {actives_livraison.map((o) => {
              const s = STATUS[o.statut];
              return (
                <div key={o.id} style={{ background: "white", border: "1px solid #ECE8DC", borderLeft: `4px solid ${s.color}`, borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontWeight: 700, fontSize: 15.5 }}>{o.client}</div>
                  <div style={{ fontSize: 13, color: "#6B7168", marginTop: 3 }}>{o.produit}</div>
                  <div style={{ fontSize: 13, color: "#6B7168", marginTop: 2 }}>📍 {o.zone}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 17, marginTop: 8, color: "#1a7a3c" }}>{formatFCFA(o.montant)}</div>

                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <a
                      href={`tel:${o.tel}`}
                      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "white", border: "1px solid #DDD8CC", color: "#16231F", padding: "10px 0", borderRadius: 9, fontWeight: 600, fontSize: 13, textDecoration: "none" }}
                    >
                      <Phone size={15} /> {o.tel}
                    </a>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => onStatus(o.id, "confirmee")}
                      style={{ flex: 1, background: "#1F9D6E", color: "white", border: "none", padding: "11px 0", borderRadius: 9, fontWeight: 700, fontSize: 13.5 }}
                    >
                      ✅ Confirmer
                    </button>
                    <button
                      onClick={() => onStatus(o.id, "echouee")}
                      style={{ flex: 1, background: "#D64933", color: "white", border: "none", padding: "11px 0", borderRadius: 9, fontWeight: 700, fontSize: 13.5 }}
                    >
                      ❌ Échoué
                    </button>
                  </div>
                </div>
              );
            })}
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
              {actives_expedition.map((o) => (
                <div key={o.id} style={{ background: "white", border: "1px solid #ECE8DC", borderLeft: "4px solid #2452E8", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontWeight: 700, fontSize: 15.5 }}>{o.client}</div>
                  <div style={{ fontSize: 13, color: "#6B7168", marginTop: 3 }}>{o.produit}</div>
                  <div style={{ fontSize: 13, color: "#2452E8", marginTop: 2, fontWeight: 600 }}>📦 Destination : {o.zone || "non précisée"}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 17, marginTop: 8, color: "#1a7a3c" }}>{formatFCFA(o.montant + (o.frais_expedition || 0))}</div>

                  {!o.depot_recu && (
                    <div style={{ background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 8, padding: "8px 10px", marginTop: 10, fontSize: 11.5, color: "#8A6412" }}>
                      ⏳ En attente — l'administrateur doit d'abord confirmer avoir reçu le dépôt du client.
                    </div>
                  )}

                  {o.depot_recu && !o.expedition_confirmee && (
                    <label style={{ display: "block", textAlign: "center", width: "100%", background: "#2452E8", color: "white", padding: "11px 0", borderRadius: 9, fontWeight: 700, fontSize: 13.5, cursor: "pointer", marginTop: 12, boxSizing: "border-box" }}>
                      {envoiPhotoId === o.id ? "Envoi en cours..." : "📷 Confirmer l'expédition (photo du reçu)"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: "none" }}
                        onChange={(e) => confirmerExpedition(o.id, e.target.files?.[0])}
                      />
                    </label>
                  )}

                  {o.expedition_confirmee && (
                    <div style={{ background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 8, padding: "9px 12px", marginTop: 10, fontSize: 12.5, color: "#3B6D11", fontWeight: 600, textAlign: "center" }}>
                      ✅ Expédition confirmée
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#16231F", color: "white", padding: "9px 18px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function CloserPortal({ closer, orders, relanceCountByOrder, onStatus, onReschedule, onRelanceAdded, toast, onMarquerDepot }) {
  const [selected, setSelected] = useState(null);

  const todo = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const now24hAgo = new Date(today.getTime() - 24 * 3600 * 1000);
    const byMontant = (a, b) => Number(b.montant) - Number(a.montant);

    const actives = orders.filter((o) => o.statut === "en_cours" || o.statut === "echouee");

    const aRelivrer = actives.filter((o) => o.date_relivraison === todayStr).sort(byMontant);

    const jamaisContactees = actives
      .filter((o) => !relanceCountByOrder.count[o.id] && aRelivrer.every((a) => a.id !== o.id))
      .sort(byMontant);

    const sansNouvelles = actives
      .filter((o) => {
        if (aRelivrer.some((a) => a.id === o.id)) return false;
        if (jamaisContactees.some((j) => j.id === o.id)) return false;
        const last = relanceCountByOrder.last[o.id];
        if (!last) return false;
        return new Date(last) < now24hAgo;
      })
      .sort(byMontant);

    const dejaTraitees = actives.filter((o) =>
      !aRelivrer.some((a) => a.id === o.id) &&
      !jamaisContactees.some((j) => j.id === o.id) &&
      !sansNouvelles.some((s) => s.id === o.id)
    ).sort(byMontant);

    const confirmees = orders.filter((o) => o.statut === "confirmee");

    return { aRelivrer, jamaisContactees, sansNouvelles, dejaTraitees, confirmees, total: actives.length };
  }, [orders, relanceCountByOrder]);

  const sections = [
    { key: "aRelivrer", title: "📅 À relivrer aujourd'hui", items: todo.aRelivrer, color: "#1a7a3c" },
    { key: "jamaisContactees", title: "🆕 Jamais appelées", items: todo.jamaisContactees, color: "#8A6412" },
    { key: "sansNouvelles", title: "⏰ Sans nouvelles depuis 24h+", items: todo.sansNouvelles, color: "#D64933" },
    { key: "dejaTraitees", title: "✅ Déjà relancées récemment", items: todo.dejaTraitees, color: "#6B7168" },
  ];

  const montantRecupere = todo.confirmees.reduce((s, o) => s + Number(o.montant), 0);
  const montantARisque = orders.filter((o) => o.statut === "en_cours" || o.statut === "echouee").reduce((s, o) => s + Number(o.montant), 0);
  const tauxConfirmation = orders.length ? Math.round((todo.confirmees.length / orders.length) * 100) : 0;

  return (
    <div style={{ background: "#FAFAF7", minHeight: "100vh", fontFamily: "'IBM Plex Sans', sans-serif", color: "#16231F", paddingBottom: 20 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        button { font-family: inherit; cursor: pointer; transition: transform 0.12s ease; }
        button:active { transform: scale(0.97); }
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
        @keyframes rv3DFloat {
          0%, 100% { transform: rotateX(0deg) rotateY(0deg) translateZ(0); }
          25% { transform: rotateX(3deg) rotateY(-4deg) translateZ(6px); }
          50% { transform: rotateX(0deg) rotateY(0deg) translateZ(0); }
          75% { transform: rotateX(-3deg) rotateY(4deg) translateZ(6px); }
        }
        .rv-glass-card { position: relative; overflow: hidden; border-radius: 12px; padding: 11px 13px; background: linear-gradient(155deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0.1) 100%); border: 1px solid rgba(255,255,255,0.25); box-shadow: 0 4px 14px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 0 rgba(0,0,0,0.08); }
        .rv-glass-shine { position: absolute; top: -50%; left: -60%; width: 60%; height: 200%; background: linear-gradient(120deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%); transform: rotate(20deg); animation: rvShineSweep 3.5s ease-in-out infinite; pointer-events: none; }
        @keyframes rvShineSweep { 0% { left: -60%; } 35%, 100% { left: 140%; } }
        .rv-livedot { animation: rvPulseDot 2s ease-in-out infinite; }
        @keyframes rvPulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>

      <div style={{ background: "#1a7a3c", color: "white", padding: "20px 16px 24px", position: "relative", overflow: "hidden" }}>
        <div className="rv-mesh-blob rv-mesh-1" />
        <div className="rv-mesh-blob rv-mesh-2" />
        <div className="rv-mesh-blob rv-mesh-3" />

        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 90, overflow: "hidden", pointerEvents: "none" }}>
          <svg className="rv-wave-1" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", bottom: -5, width: "200%", height: 70 }}>
            <path d="M0,30 C40,10 80,50 120,30 C160,10 200,50 240,30 C280,10 320,50 360,30 C380,20 390,25 400,30 L400,60 L0,60 Z" fill="rgba(232,146,10,0.55)" />
          </svg>
          <svg className="rv-wave-2" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", bottom: -8, width: "200%", height: 60 }}>
            <path d="M0,25 C50,45 90,5 140,25 C190,45 230,5 280,25 C330,45 370,5 400,20 L400,60 L0,60 Z" fill="rgba(255,255,255,0.4)" />
          </svg>
          <svg className="rv-wave-3" viewBox="0 0 400 60" preserveAspectRatio="none" style={{ position: "absolute", bottom: -3, width: "200%", height: 50 }}>
            <path d="M0,35 C60,15 100,45 160,25 C220,5 260,45 320,25 C360,10 380,30 400,25 L400,60 L0,60 Z" fill="rgba(248,180,60,0.4)" />
          </svg>
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 100 100">
                <polyline points="15,62 40,42 55,56 85,28" stroke="#e8920a" strokeWidth="11" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 17 }}>
              RECU<span style={{ color: "#e8920a" }}>VENTE</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4, opacity: 0.65 }}>
              <span className="rv-livedot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#7fd6a3", display: "inline-block" }} />
              <span style={{ fontSize: 9.5, fontWeight: 500 }}>EN DIRECT</span>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              style={{ marginLeft: "auto", background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 500 }}
            >
              Déconnexion
            </button>
          </div>

          <div style={{ marginTop: 18, fontSize: 13, opacity: 0.8 }}>Bonjour</div>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22 }}>{closer.nom}</div>

          <div style={{ marginTop: 16, perspective: "800px" }}>
            <div className="rv-3d-card" style={{ position: "relative", padding: "12px 14px", borderRadius: 14, background: "linear-gradient(155deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 70%)", border: "1px solid rgba(255,255,255,0.18)", boxShadow: "0 10px 24px rgba(0,0,0,0.2)" }}>
              <div className="rv-glow" style={{ position: "absolute", top: -16, left: -16, width: 100, height: 100, borderRadius: "50%", background: "radial-gradient(circle, rgba(232,146,10,0.35) 0%, rgba(232,146,10,0) 70%)", pointerEvents: "none" }} />
              <div style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.04em", position: "relative" }}>Argent récupéré (mes commandes)</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 30, marginTop: 3, color: "#e8920a", position: "relative" }}>
                {formatFCFA(montantRecupere)}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <div className="rv-glass-card" style={{ flex: 1 }}>
              <div className="rv-glass-shine" />
              <div style={{ fontSize: 10.5, opacity: 0.75, position: "relative" }}>À traiter</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, position: "relative" }}>{todo.total}</div>
            </div>
            <div className="rv-glass-card" style={{ flex: 1 }}>
              <div className="rv-glass-shine" />
              <div style={{ fontSize: 10.5, opacity: 0.75, position: "relative" }}>Confirmées</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, position: "relative" }}>{todo.confirmees.length}</div>
            </div>
            <div className="rv-glass-card" style={{ flex: 1 }}>
              <div className="rv-glass-shine" />
              <div style={{ fontSize: 10.5, opacity: 0.75, position: "relative" }}>Taux</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, position: "relative" }}>{tauxConfirmation}%</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "18px 20px" }}>
        {todo.total === 0 ? (
          <div style={{ textAlign: "center", padding: "50px 20px", color: "#8A9089" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
            <div style={{ fontSize: 14 }}>Aucune commande à traiter pour le moment.</div>
          </div>
        ) : (
          sections.map((sec) =>
            sec.items.length > 0 ? (
              <div key={sec.key} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: sec.color }}>
                  {sec.title} ({sec.items.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {sec.items.map((o, oi) => (
                    <button
                      key={o.id}
                      onClick={() => setSelected(o)}
                      style={{ textAlign: "left", background: "white", border: "1px solid #ECE8DC", borderLeft: `4px solid ${sec.color}`, borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: oi === 0 && sec.key !== "dejaTraitees" ? sec.color : "#ECE8DC", color: oi === 0 && sec.key !== "dejaTraitees" ? "white" : "#8A9089", fontSize: 10.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {oi + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14.5 }}>{o.client}</div>
                        <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{o.produit} · {o.tel}</div>
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 14.5, flexShrink: 0 }}>{formatFCFA(o.montant)}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null
          )
        )}
      </div>

      {selected && (
        <OrderDetail
          order={selected}
          onClose={() => setSelected(null)}
          onStatus={(id, statut) => { onStatus(id, statut); setSelected(null); }}
          onReschedule={onReschedule}
          onRelanceAdded={onRelanceAdded}
          onMarquerDepot={onMarquerDepot}
        />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#16231F", color: "white", padding: "9px 18px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function CarteLivreurs({ livreurs }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);

  const enTourneeAvecPosition = livreurs.filter(
    (l) => l.en_tournee && l.position_lat && l.position_lng
  );

  useEffect(() => {
    if (!window.L || !mapRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = window.L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([5.359952, -4.008256], 12); // Abidjan par défaut

      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);
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
      <div
        ref={mapRef}
        style={{ width: "100%", height: 220, borderRadius: 12, overflow: "hidden", border: "1px solid #ECE8DC", background: "#EEF0EA" }}
      />
      {enTourneeAvecPosition.length === 0 && (
        <div style={{ fontSize: 12, color: "#8A9089", marginTop: 6 }}>Aucun livreur en tournée pour le moment.</div>
      )}
    </div>
  );
}

function ComptablesModal({ comptables, onDelete, onAddClick, onClose }) {
  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxHeight: "80vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Comptables</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        <div style={{ fontSize: 12.5, color: "#6B7168", marginBottom: 14 }}>
          Accès en lecture seule à la comptabilité (commandes, montants, dépôts) — aucune modification possible, aucune gestion d'équipe.
        </div>

        <button
          onClick={onAddClick}
          style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "#1a7a3c", color: "white", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 16 }}
        >
          <Plus size={17} /> Ajouter un comptable
        </button>

        {comptables.length === 0 && (
          <div style={{ textAlign: "center", padding: "30px 0", color: "#8A9089", fontSize: 14 }}>Aucun comptable ajouté.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {comptables.map((c) => (
            <div key={c.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.nom}</div>
                <div style={{ fontSize: 12, color: "#6B7168", marginTop: 2 }}>{c.email || "Pas d'email — pas encore de connexion possible"}</div>
              </div>
              <button onClick={() => onDelete(c.id)} style={{ background: "none", border: "none", color: "#D64933", padding: 6 }} aria-label="Retirer">
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddComptable({ onClose, onAdd }) {
  const [form, setForm] = useState({ nom: "", email: "", telephone: "" });
  const canSubmit = form.nom;

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 55 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Nouveau comptable</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Nom</label>
          <input
            value={form.nom}
            onChange={(e) => setForm({ ...form, nom: e.target.value })}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Email de connexion</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="pour lui donner accès à la comptabilité"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
          />
          <div style={{ fontSize: 11, color: "#8A9089", marginTop: 4 }}>
            Crée-lui d'abord un compte via "Inviter", avec ce même email.
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Téléphone (optionnel)</label>
          <input
            value={form.telephone}
            onChange={(e) => setForm({ ...form, telephone: e.target.value })}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
          />
        </div>

        <button
          disabled={!canSubmit}
          onClick={() => canSubmit && onAdd(form)}
          style={{ width: "100%", marginTop: 6, padding: "13px 0", borderRadius: 10, border: "none", background: canSubmit ? "#1a7a3c" : "#DDD8CC", color: "white", fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Check size={17} /> Ajouter le comptable
        </button>
      </div>
    </div>
  );
}

function ComptablePortal({ comptable, orders, livreurs }) {
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

  const ordersInRange = useMemo(() => {
    return orders.filter((o) => {
      const d = new Date(o.created_at);
      return d >= dateRange.start && d < dateRange.end;
    });
  }, [orders, dateRange]);

  const COUT_LIVRAISON = 1500;

  const stats = useMemo(() => {
    const confirmees = ordersInRange.filter((o) => o.statut === "confirmee");
    const echouees = ordersInRange.filter((o) => o.statut === "echouee");
    const enCours = ordersInRange.filter((o) => o.statut === "en_cours");
    const chiffreAffaires = ordersInRange.reduce((s, o) => s + Number(o.montant) + Number(o.frais_expedition || 0), 0);
    const montantConfirme = confirmees.reduce((s, o) => s + Number(o.montant) + Number(o.frais_expedition || 0), 0);
    const coutLivraisons = confirmees.length * COUT_LIVRAISON;
    const beneficeReel = montantConfirme - coutLivraisons;
    return { total: ordersInRange.length, confirmees: confirmees.length, echouees: echouees.length, enCours: enCours.length, chiffreAffaires, montantConfirme, coutLivraisons, beneficeReel };
  }, [ordersInRange]);

  const livreursStats = useMemo(() => {
    return livreurs
      .map((l) => {
        const mesCommandes = ordersInRange.filter((o) => o.livreur === l.nom);
        const livrees = mesCommandes.filter((o) => o.statut === "confirmee");
        const montantRecupere = livrees.reduce((s, o) => s + Number(o.montant), 0);
        const montantDu = livrees.length * COUT_LIVRAISON;
        const montantADeposer = montantRecupere - montantDu;
        return { ...l, total: mesCommandes.length, livrees: livrees.length, montantRecupere, montantDu, montantADeposer };
      })
      .filter((l) => l.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [livreurs, ordersInRange]);

  const produitsCA = useMemo(() => {
    const map = {};
    ordersInRange.forEach((o) => {
      const { nom, quantite } = parseProduitTexte(o.produit);
      if (!nom) return;
      if (!map[nom]) map[nom] = { nom, commandes: 0, pieces: 0, ca: 0, caConfirme: 0, livrees: 0 };
      map[nom].commandes += 1;
      map[nom].pieces += quantite;
      map[nom].ca += Number(o.montant);
      if (o.statut === "confirmee") {
        map[nom].caConfirme += Number(o.montant);
        map[nom].livrees += 1;
      }
    });
    return Object.values(map).sort((a, b) => b.ca - a.ca);
  }, [ordersInRange]);

  const totalPieces = produitsCA.reduce((s, p) => s + p.pieces, 0);
  const totalCommandesProduits = produitsCA.reduce((s, p) => s + p.commandes, 0);
  const totalCAProduits = produitsCA.reduce((s, p) => s + p.ca, 0);

  const produitsParLivreur = useMemo(() => {
    const result = {};
    livreurs.forEach((l) => {
      const mesCommandes = ordersInRange.filter((o) => o.livreur === l.nom);
      const map = {};
      mesCommandes.forEach((o) => {
        const { nom, quantite } = parseProduitTexte(o.produit);
        if (!nom) return;
        if (!map[nom]) map[nom] = { nom, pieces: 0, ca: 0 };
        if (o.statut === "confirmee") {
          map[nom].pieces += quantite;
          map[nom].ca += Number(o.montant);
        }
      });
      result[l.nom] = Object.values(map).sort((a, b) => b.ca - a.ca);
    });
    return result;
  }, [livreurs, ordersInRange]);

  const totalDu = livreursStats.reduce((s, l) => s + l.montantDu, 0);
  const totalADeposer = livreursStats.reduce((s, l) => s + l.montantADeposer, 0);

  return (
    <div style={{ background: "#FAFAF7", minHeight: "100vh", fontFamily: "'IBM Plex Sans', sans-serif", color: "#16231F", paddingBottom: 30 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        @media print {
          .rv-no-print { display: none !important; }
          .rv-print-only { display: block !important; }
          body, .rv-app { background: white !important; }
          * { box-shadow: none !important; }
        }
      `}</style>

      <div className="rv-no-print" style={{ background: "#16231F", color: "white", padding: "22px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
            🧮
          </div>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 17 }}>
            RECU<span style={{ color: "#e8920a" }}>VENTE</span> — Comptabilité
          </div>
          <button
            onClick={() => window.print()}
            style={{ marginLeft: "auto", background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 10px", borderRadius: 7, fontSize: 12, fontWeight: 500 }}
          >
            🖨️
          </button>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ background: "rgba(255,255,255,0.14)", border: "none", color: "white", padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 500 }}
          >
            Déconnexion
          </button>
        </div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>Bonjour {comptable.nom}</div>
      </div>

      <div className="rv-print-only" style={{ display: "none", padding: "20px 20px 0" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 20 }}>Rapport comptable — RecuVente</div>
        <div style={{ fontSize: 12, color: "#6B7168" }}>Édité le {new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} — {periodLabelFromPreset(datePreset)}</div>
      </div>

      <div className="rv-no-print" style={{ margin: "16px 20px 0", display: "flex", gap: 7, overflowX: "auto" }}>
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
            style={{
              padding: "6px 13px",
              borderRadius: 999,
              border: "1px solid " + (datePreset === d.key ? "#1a7a3c" : "#DDD8CC"),
              background: datePreset === d.key ? "#1a7a3c" : "white",
              color: datePreset === d.key ? "white" : "#16231F",
              fontSize: 12.5,
              fontWeight: 500,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      {datePreset === "personnalise" && (
        <div className="rv-no-print" style={{ margin: "8px 20px 0", display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }} />
          <span style={{ color: "#8A9089", fontSize: 12 }}>à</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 13 }} />
        </div>
      )}

      <div style={{ margin: "16px 20px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase" }}>Chiffre d'affaires</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, marginTop: 3 }}>{formatFCFA(stats.chiffreAffaires)}</div>
        </div>
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase" }}>Commandes</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 18, marginTop: 3 }}>{stats.total}</div>
        </div>
      </div>

      <div style={{ margin: "10px 20px 0" }}>
        <div style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 14, padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>💰 Bénéfice réel</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 24, color: stats.beneficeReel >= 0 ? "#7fd6a3" : "#f0a0a0", marginTop: 3 }}>
            {formatFCFA(stats.beneficeReel)}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
            CA confirmé {formatFCFA(stats.montantConfirme)} − Livraisons ({stats.confirmees} × {formatFCFA(COUT_LIVRAISON)})
          </div>
        </div>
      </div>

      <div style={{ margin: "16px 20px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>💵 À payer aux livreurs</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, color: "#e8920a", marginTop: 3 }}>{formatFCFA(totalDu)}</div>
        </div>
        <div style={{ background: "linear-gradient(135deg, #1a7a3c, #1F9D6E)", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.75)", textTransform: "uppercase" }}>🏦 Dépôt attendu</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, color: "white", marginTop: 3 }}>{formatFCFA(totalADeposer)}</div>
        </div>
      </div>

      <div style={{ padding: "20px 20px 0" }}>
        <ResumeMultiPeriodes orders={orders} livreurs={livreurs} />

        {produitsCA.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>
              💵 Chiffre d'affaires par produit ({periodLabelFromPreset(datePreset)})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {produitsCA.map((p) => (
                <div key={p.nom} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{p.nom}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 14, color: "#1a7a3c" }}>{formatFCFA(p.ca)}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#6B7168", marginTop: 3 }}>
                    {p.commandes} commande{p.commandes > 1 ? "s" : ""} ({p.pieces} pièce{p.pieces > 1 ? "s" : ""}) · {p.livrees} livrée{p.livrees > 1 ? "s" : ""} · dont {formatFCFA(p.caConfirme)} confirmé
                  </div>
                </div>
              ))}
              <div style={{ background: "#16231F", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "white" }}>Total — {totalCommandesProduits} commande{totalCommandesProduits > 1 ? "s" : ""} ({totalPieces} pièce{totalPieces > 1 ? "s" : ""})</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, color: "#e8920a" }}>{formatFCFA(totalCAProduits)}</span>
              </div>
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>📊 Résumé — commandes reçues par livreur ({periodLabelFromPreset(datePreset)})</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          {livreursStats.map((l) => (
            <div key={l.id + "-resume"} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 8, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13 }}><strong>{l.nom}</strong> a reçu</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 14, color: "#1a7a3c" }}>{l.total} commande{l.total > 1 ? "s" : ""}</span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>Détail par livreur ({periodLabelFromPreset(datePreset)})</div>
        {livreursStats.length === 0 && (
          <div style={{ textAlign: "center", padding: "30px 0", color: "#8A9089", fontSize: 14 }}>Aucune livraison sur cette période.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {livreursStats.map((l) => (
            <LivreurDetailComptable key={l.id} l={l} produits={produitsParLivreur[l.nom] || []} />
          ))}
        </div>
      </div>
    </div>
  );
}

function LivreurDetailComptable({ l, produits }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "14px 16px" }}>
      <div onClick={() => setOpen(!open)} style={{ cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{l.nom}</div>
          <span style={{ fontSize: 11.5, color: "#1a7a3c", fontWeight: 600 }}>{open ? "Fermer ▲" : "Voir le détail ▼"}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{l.livrees} livraison{l.livrees > 1 ? "s" : ""} · {formatFCFA(l.montantRecupere)} encaissé</div>
      </div>
      <div style={{ marginTop: 8, background: "#FBF3E3", border: "1px solid #F0DDA8", borderRadius: 8, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#8A6412", fontWeight: 600 }}>💵 Sa commission</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 14, color: "#8A6412" }}>{formatFCFA(l.montantDu)}</span>
      </div>
      <div style={{ marginTop: 6, background: "#EAF3DE", border: "1px solid #C7DDA3", borderRadius: 8, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#3B6D11", fontWeight: 600 }}>🏦 Doit déposer</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 14, color: "#3B6D11" }}>{formatFCFA(l.montantADeposer)}</span>
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F0EEE6" }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", marginBottom: 6 }}>CA par produit</div>
          {produits.length === 0 && <div style={{ fontSize: 12.5, color: "#8A9089" }}>Aucune vente confirmée sur cette période.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {produits.map((p) => (
              <div key={p.nom} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span style={{ color: "#6B7168" }}>{p.nom} <span style={{ color: "#8A9089" }}>({p.pieces} pc)</span></span>
                <span style={{ fontWeight: 600 }}>{formatFCFA(p.ca)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ComptaDetailModal({ stats, livreursStats, coutLivraison, periodLabel, orders, livreurs, repartitionCloserLivreur, onClose }) {
  const actifs = livreursStats.filter((l) => l.livrees > 0);
  const livreursAvecCommandes = livreursStats.filter((l) => l.total > 0).sort((a, b) => b.total - a.total);
  const totalDu = actifs.reduce((s, l) => s + (l.montantDu || 0), 0);
  const totalADeposer = actifs.reduce((s, l) => s + (l.montantRecupere - (l.montantDu || 0)), 0);
  const [ligneOuverte, setLigneOuverte] = useState(null);

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.6)", display: "flex", alignItems: "flex-end", zIndex: 55 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxHeight: "85vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Comptabilité détaillée</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>
        {periodLabel && (
          <div style={{ display: "inline-block", fontSize: 11, fontWeight: 600, color: "#1a7a3c", background: "#EAF3DE", padding: "3px 10px", borderRadius: 999, marginBottom: 16 }}>
            📊 {periodLabel}
          </div>
        )}

        <div style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 14, padding: "16px 18px", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>💰 Bénéfice réel</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 24, color: stats.beneficeReel >= 0 ? "#7fd6a3" : "#f0a0a0", marginTop: 3 }}>
            {formatFCFA(stats.beneficeReel)}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div style={{ background: "linear-gradient(135deg, #16231F, #1e2f28)", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.65)", textTransform: "uppercase" }}>💵 À payer aux livreurs</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, color: "#e8920a", marginTop: 3 }}>{formatFCFA(totalDu)}</div>
          </div>
          <div style={{ background: "linear-gradient(135deg, #1a7a3c, #1F9D6E)", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.75)", textTransform: "uppercase" }}>🏦 Dépôt attendu</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 19, color: "white", marginTop: 3 }}>{formatFCFA(totalADeposer)}</div>
          </div>
        </div>

        <ResumeMultiPeriodes orders={orders} livreurs={livreurs} />

        <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>Détail par livreur ({periodLabel})</div>
        {actifs.length === 0 && (
          <div style={{ textAlign: "center", padding: "20px 0", color: "#8A9089", fontSize: 13.5 }}>Aucune livraison sur cette période.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {actifs.map((l) => (
            <div key={l.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{l.nom}</div>
              <div style={{ fontSize: 12, color: "#6B7168", marginTop: 2 }}>{l.livrees} livraison{l.livrees > 1 ? "s" : ""} · {formatFCFA(l.montantRecupere)} encaissé</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1, background: "#FBF3E3", borderRadius: 7, padding: "6px 9px", fontSize: 11.5, color: "#8A6412" }}>
                  Commission : <strong>{formatFCFA(l.montantDu)}</strong>
                </div>
                <div style={{ flex: 1, background: "#EAF3DE", borderRadius: 7, padding: "6px 9px", fontSize: 11.5, color: "#3B6D11" }}>
                  À déposer : <strong>{formatFCFA(l.montantRecupere - l.montantDu)}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>

        {livreursAvecCommandes.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>
              📊 Résumé — commandes reçues par livreur ({periodLabel})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {livreursAvecCommandes.map((l) => (
                <div key={l.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 8, padding: "9px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13 }}><strong>{l.nom}</strong> a reçu</span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 14, color: "#1a7a3c" }}>{l.total} commande{l.total > 1 ? "s" : ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {repartitionCloserLivreur && repartitionCloserLivreur.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 10 }}>
              🔄 Répartition Closer → Livreur ({periodLabel})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {repartitionCloserLivreur.map((r, i) => {
                const key = r.closer + "|||" + r.livreur;
                const open = ligneOuverte === key;
                return (
                  <div key={i} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 10, padding: "10px 12px" }}>
                    <button
                      onClick={() => setLigneOuverte(open ? null : key)}
                      style={{ width: "100%", background: "none", border: "none", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left" }}
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
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProduitsModal({ produits, onDelete, onUpdateCout, onUpdateStock, quantitesParProduit, onAddClick, onClose }) {
  const [editId, setEditId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [editStockId, setEditStockId] = useState(null);
  const [editStockValue, setEditStockValue] = useState("");

  function commencerEdition(p) {
    setEditId(p.id);
    setEditValue(String(p.cout_achat));
  }

  function validerEdition(id) {
    onUpdateCout(id, editValue);
    setEditId(null);
  }

  function commencerEditionStock(p) {
    setEditStockId(p.id);
    setEditStockValue(String(p.stock_initial || 0));
  }

  function validerEditionStock(id) {
    onUpdateStock(id, editStockValue);
    setEditStockId(null);
  }

  const totalStock = produits.reduce((s, p) => s + Number(p.stock_initial || 0), 0);
  const totalVendu = produits.reduce((s, p) => s + (quantitesParProduit[p.nom]?.commandees || 0), 0);
  const totalLivre = produits.reduce((s, p) => s + (quantitesParProduit[p.nom]?.livrees || 0), 0);

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxHeight: "85vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Catalogue & Stock</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        <div style={{ fontSize: 12.5, color: "#6B7168", marginBottom: 14 }}>
          Le nom doit correspondre exactement à celui utilisé dans tes commandes. Renseigne le stock acheté (Alibaba) pour suivre ce qu'il reste.
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

        <button
          onClick={onAddClick}
          style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: "#1a7a3c", color: "white", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 16 }}
        >
          <Plus size={17} /> Ajouter un produit
        </button>

        {produits.length === 0 && (
          <div style={{ textAlign: "center", padding: "30px 0", color: "#8A9089", fontSize: 14 }}>Aucun produit dans le catalogue.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {produits.map((p) => {
            const q = quantitesParProduit[p.nom] || { commandees: 0, livrees: 0 };
            const stock = Number(p.stock_initial || 0);
            const restant = stock - q.commandees;
            return (
              <div key={p.id} style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nom}</div>
                    {editId === p.id ? (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #DDD8CC", fontSize: 13 }} />
                        <button onClick={() => validerEdition(p.id)} style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 6, padding: "0 10px", fontSize: 12, fontWeight: 600 }}>OK</button>
                      </div>
                    ) : (
                      <button onClick={() => commencerEdition(p)} style={{ background: "none", border: "none", padding: 0, marginTop: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "#6B7168", textDecoration: "underline" }}>
                        Coût : {formatFCFA(p.cout_achat)}
                      </button>
                    )}
                  </div>
                  <button onClick={() => onDelete(p.id)} style={{ background: "none", border: "none", color: "#D64933", padding: 6, flexShrink: 0 }} aria-label="Retirer">
                    <Trash2 size={17} />
                  </button>
                </div>

                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F0EEE6" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase" }}>Stock acheté</span>
                    {editStockId === p.id ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <input type="number" value={editStockValue} onChange={(e) => setEditStockValue(e.target.value)} autoFocus style={{ width: 70, padding: "4px 7px", borderRadius: 6, border: "1px solid #DDD8CC", fontSize: 12.5 }} />
                        <button onClick={() => validerEditionStock(p.id)} style={{ background: "#1a7a3c", color: "white", border: "none", borderRadius: 6, padding: "0 9px", fontSize: 11.5, fontWeight: 600 }}>OK</button>
                      </div>
                    ) : (
                      <button onClick={() => commencerEditionStock(p)} style={{ background: "none", border: "none", padding: 0, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 13.5, color: "#16231F", textDecoration: "underline" }}>
                        {stock} pièces
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 1, background: "#FBF3E3", borderRadius: 7, padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 9.5, color: "#8A6412" }}>Engagé</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#8A6412" }}>{q.commandees}</div>
                    </div>
                    <div style={{ flex: 1, background: "#EAF7F1", borderRadius: 7, padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 9.5, color: "#1F9D6E" }}>Livré</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#1F9D6E" }}>{q.livrees}</div>
                    </div>
                    <div style={{ flex: 1, background: restant <= 5 && stock > 0 ? "#FBEAE6" : "#EAF3DE", borderRadius: 7, padding: "6px 8px", textAlign: "center" }}>
                      <div style={{ fontSize: 9.5, color: restant <= 5 && stock > 0 ? "#D64933" : "#3B6D11" }}>Restant</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: restant <= 5 && stock > 0 ? "#D64933" : "#3B6D11" }}>{stock > 0 ? restant : "—"}</div>
                    </div>
                  </div>
                  {stock > 0 && restant <= 5 && restant > 0 && (
                    <div style={{ fontSize: 10.5, color: "#D64933", marginTop: 5, fontWeight: 600 }}>⚠️ Stock bientôt épuisé</div>
                  )}
                  {stock > 0 && restant <= 0 && (
                    <div style={{ fontSize: 10.5, color: "#D64933", marginTop: 5, fontWeight: 600 }}>🔴 Stock épuisé — commandes en cours risquent de ne pas être honorées</div>
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

function AddProduit({ onClose, onAdd }) {
  const [form, setForm] = useState({ nom: "", cout_achat: "" });
  const canSubmit = form.nom && form.cout_achat !== "";

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 55 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Nouveau produit</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Nom exact (comme dans tes commandes)</label>
          <input
            value={form.nom}
            onChange={(e) => setForm({ ...form, nom: e.target.value })}
            placeholder="Ex: Peineili Spray"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4 }}>Coût d'achat unitaire (FCFA)</label>
          <input
            type="number"
            value={form.cout_achat}
            onChange={(e) => setForm({ ...form, cout_achat: e.target.value })}
            placeholder="Ex: 2000"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
          />
        </div>

        <button
          disabled={!canSubmit}
          onClick={() => canSubmit && onAdd(form)}
          style={{ width: "100%", marginTop: 6, padding: "13px 0", borderRadius: 10, border: "none", background: canSubmit ? "#1a7a3c" : "#DDD8CC", color: "white", fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Check size={17} /> Ajouter au catalogue
        </button>
      </div>
    </div>
  );
}
