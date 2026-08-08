import React, { useState, useEffect, useMemo, useRef } from "react";
import { Phone, MessageCircle, MessageSquare, Plus, ChevronLeft, X, Check, Users, Truck, Trash2, Package, UserPlus, LogOut, ListChecks } from "lucide-react";
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

function exportCSV(orders) {
  const headers = ["Client", "Téléphone", "Produit", "Montant", "Zone", "Statut", "Livreur", "Date"];
  const rows = orders.map((o) => [
    o.client,
    o.tel,
    o.produit,
    o.montant,
    o.zone || "",
    STATUS[o.statut]?.label || o.statut,
    o.livreur || "",
    new Date(o.created_at).toLocaleDateString("fr-FR"),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";"))
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

export default function App() {
  const [session, setSession] = useState(undefined);
  const [orders, setOrders] = useState([]);
  const [livreurs, setLivreurs] = useState([]);
  const [view, setView] = useState("dashboard");
  const [filter, setFilter] = useState("toutes");
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAddLivreur, setShowAddLivreur] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [datePreset, setDatePreset] = useState("mois");
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

  function playNotifSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      o.start();
      o.stop(ctx.currentTime + 0.35);
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
    setLoaded(true);
  }

  async function loadLivreurs() {
    const { data, error } = await supabase
      .from("livreurs")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setLivreurs(data || []);
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
    loadRelances();
    const interval = setInterval(() => {
      loadOrders();
      loadLivreurs();
      loadRelances();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

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

  const stats = useMemo(() => {
    const confirmees = ordersInRange.filter((o) => o.statut === "confirmee");
    const echouees = ordersInRange.filter((o) => o.statut === "echouee");
    const enCours = ordersInRange.filter((o) => o.statut === "en_cours");
    const recupere = ordersInRange.reduce((sum, o) => sum + (o.recupere ? Number(o.montant) : 0), 0);
    const chiffreAffaires = ordersInRange.reduce((sum, o) => sum + Number(o.montant), 0);
    const tauxLivraison = ordersInRange.length ? Math.round((confirmees.length / ordersInRange.length) * 100) : 0;
    const tauxEchec = ordersInRange.length ? Math.round((echouees.length / ordersInRange.length) * 100) : 0;
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
    };
  }, [ordersInRange]);

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

    const aRelivrer = actives.filter((o) => o.date_relivraison === todayStr);

    const jamaisContactees = actives.filter((o) => !relanceCountByOrder.count[o.id] && aRelivrer.every((a) => a.id !== o.id));

    const sansNouvelles = actives.filter((o) => {
      if (aRelivrer.some((a) => a.id === o.id)) return false;
      if (jamaisContactees.some((j) => j.id === o.id)) return false;
      const last = relanceCountByOrder.last[o.id];
      if (!last) return false;
      return new Date(last) < now24hAgo;
    });

    return { aRelivrer, jamaisContactees, sansNouvelles, total: aRelivrer.length + jamaisContactees.length + sansNouvelles.length };
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
    const recupere = statut === "confirmee" && current?.statut === "echouee" ? true : current?.recupere;
    const { error } = await supabase.from("commandes").update({ statut, recupere }).eq("id", id);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadOrders();
    if (selected && selected.id === id) setSelected((s) => ({ ...s, statut }));
    showToast(statut === "confirmee" ? "Commande récupérée 💰" : "Statut mis à jour");
  }

  async function addOrder(order) {
    const { error } = await supabase.from("commandes").insert([
      { ...order, montant: Number(order.montant), recupere: false },
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
  }

  async function rescheduleOrder(orderId, date) {
    const { error } = await supabase.from("commandes").update({ date_relivraison: date || null }).eq("id", orderId);
    if (error) {
      showToast("Erreur: " + error.message);
      return;
    }
    await loadOrders();
    if (selected && selected.id === orderId) setSelected((s) => ({ ...s, date_relivraison: date }));
    showToast("Date de livraison mise à jour");
  }

  const livreursStats = useMemo(() => {
    const stats = livreurs.map((l) => {
      const mesCommandes = orders.filter((o) => o.livreur === l.nom);
      const livrees = mesCommandes.filter((o) => o.statut === "confirmee");
      const echouees = mesCommandes.filter((o) => o.statut === "echouee");
      const total = mesCommandes.length;
      const taux = total ? Math.round((livrees.length / total) * 100) : null;
      const montantRecupere = livrees.reduce((s, o) => s + Number(o.montant), 0);
      const montantPerdu = echouees.reduce((s, o) => s + Number(o.montant), 0);
      return { ...l, total, livrees: livrees.length, echouees: echouees.length, taux, montantRecupere, montantPerdu };
    });
    return stats.sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1));
  }, [livreurs, orders]);

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
      .map((c) => ({
        ...c,
        total: c.commandes.length,
        confirmees: c.commandes.filter((o) => o.statut === "confirmee").length,
        echouees: c.commandes.filter((o) => o.statut === "echouee").length,
        montantTotal: c.commandes.reduce((s, o) => s + (o.recupere ? Number(o.montant) : 0), 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [orders]);

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

  const meilleurProduit = produits[0] || null;
  const produitPlusRentable = produits.length ? [...produits].sort((a, b) => b.revenus - a.revenus)[0] : null;
  const meilleurLivreur = livreursStats.length ? [...livreursStats].sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1))[0] : null;

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
          { key: "clients", label: "Clients", icon: Users },
          { key: "livreurs", label: "Livreurs", icon: Truck },
        ].map((t) => {
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
            onClick={() => (view === "livreurs" ? setShowAddLivreur(true) : setShowAdd(true))}
            style={{ width: "100%", padding: "10px 0", borderRadius: 9, border: "none", background: "#e8920a", color: "#16231F", fontWeight: 700, fontSize: 13.5, display: view === "clients" ? "none" : "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 8 }}
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
      <div style={{ background: "#1a7a3c", color: "#FAFAF7", padding: "20px 16px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 100 100">
                <polyline points="15,62 40,42 55,56 85,28" stroke="#e8920a" strokeWidth="11" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
              RECU<span style={{ color: "#e8920a" }}>VENTE</span>
            </div>
          </div>
          <div className="rv-mobile-only-logout" style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
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

        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12, opacity: 0.75, letterSpacing: "0.04em", textTransform: "uppercase" }}>Argent récupéré</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 38, marginTop: 4, color: "#e8920a" }}>
            {formatFCFA(stats.recupere)}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>À risque</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 20 }}>{stats.aRisque}</div>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Taux livraison</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 20 }}>{stats.tauxLivraison}%</div>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Total</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 20 }}>{stats.total}</div>
          </div>
        </div>
      </div>

      <div style={{ margin: "14px 20px 0", display: "flex", gap: 7, overflowX: "auto", paddingBottom: 2 }}>
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
          <span style={{ fontSize: 12.5, color: "#8A6412" }}>🔔 Active les notifications pour être alerté des nouvelles commandes</span>
          <button
            onClick={() => Notification.requestPermission().then((p) => setNotifPermission(p))}
            style={{ background: "#e8920a", color: "#16231F", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}
          >
            Activer
          </button>
        </div>
      )}

      <div style={{ margin: "14px 20px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px" }}>
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
        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.03em" }}>Taux d'échec</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 18, marginTop: 3, color: "#D64933" }}>{stats.tauxEchec}%</div>
        </div>
      </div>

      {clientsSuspects.length > 0 && (
        <div style={{ margin: "14px 20px 0", background: "#FBEAE6", border: "1px solid #F0B8AC", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#D64933", marginBottom: 6 }}>⚠️ {clientsSuspects.length} client{clientsSuspects.length > 1 ? "s" : ""} avec 3+ échecs</div>
          {clientsSuspects.slice(0, 3).map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: "#B23A22" }}>{c.nom} ({c.tel}) — {c.echouees} échecs sur {c.total}</div>
          ))}
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
                      <div style={{ fontSize: 11.5, color: s.color, marginTop: 4, fontWeight: 500 }}>{o.derniere_tentative}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 15 }}>{formatFCFA(o.montant)}</div>
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
          <TodayView todo={todoAujourdhui} onSelectOrder={(o) => { setView("dashboard"); setSelected(o); }} />
        </div>
      )}

      {view === "clients" && (
        <div className="rv-fadein">
          <ClientsView clients={clients} onSelect={setSelectedClient} />
        </div>
      )}

      {view === "livreurs" && (
        <div className="rv-fadein">
          <LivreursView livreurs={livreursStats} onDelete={deleteLivreur} />
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
          { key: "clients", label: "Clients", icon: Users },
          { key: "livreurs", label: "Livreurs", icon: Truck },
        ].map((t) => {
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
        onClick={() => (view === "livreurs" ? setShowAddLivreur(true) : setShowAdd(true))}
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
          display: view === "clients" ? "none" : "flex",
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
          onReschedule={rescheduleOrder}
          onRelanceAdded={loadRelances}
        />
      )}
      {showAdd && <AddOrder onClose={() => setShowAdd(false)} onAdd={addOrder} />}
      {showAddLivreur && <AddLivreur onClose={() => setShowAddLivreur(false)} onAdd={addLivreur} />}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
      {showTeam && <TeamModal onClose={() => setShowTeam(false)} currentUserId={session.user.id} />}
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

function OrderDetail({ order, onClose, onStatus, livreurs, onAssignLivreur, onReschedule, onRelanceAdded }) {
  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", padding: 4 }}>
            <ChevronLeft size={22} />
          </button>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>{order.client}</div>
        </div>

        <div style={{ display: "flex", gap: 8, fontSize: 13, color: "#6B7168", marginBottom: 14 }}>
          <span>{order.tel}</span>·<span>{order.zone}</span>
        </div>

        <div style={{ background: "white", border: "1px solid #ECE8DC", borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.04em" }}>Commande</div>
          <div style={{ fontWeight: 600, marginTop: 2 }}>{order.produit}</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 20, marginTop: 6, color: "#1a7a3c" }}>{formatFCFA(order.montant)}</div>
        </div>

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

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#8A9089", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Statut</div>
          <div style={{ display: "flex", gap: 8 }}>
            {Object.entries(STATUS).map(([key, val]) => (
              <button
                key={key}
                onClick={() => onStatus(order.id, key)}
                style={{
                  flex: 1,
                  padding: "8px 6px",
                  borderRadius: 8,
                  border: `1px solid ${order.statut === key ? val.color : "#DDD8CC"}`,
                  background: order.statut === key ? val.bg : "white",
                  color: order.statut === key ? val.color : "#6B7168",
                  fontSize: 12.5,
                  fontWeight: 600,
                }}
              >
                {val.label}
              </button>
            ))}
          </div>
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

        <RelancesHistorique orderId={order.id} onAdded={onRelanceAdded} />

        <div style={{ background: "#EAF7F1", border: "1px solid #CFEBDD", borderRadius: 12, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#1F9D6E", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            <Phone size={13} /> Script d'appel suggéré
          </div>
          <div style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>{scriptAppel(order)}</div>
        </div>

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
  const [form, setForm] = useState({ client: "", tel: "", produit: "", montant: "", zone: "", statut: "en_cours", derniere_tentative: "Nouvelle commande" });
  const canSubmit = form.client && form.tel && form.produit && form.montant;

  return (
    <div className="rv-modal-backdrop" style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div className="rv-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 19 }}>Nouvelle commande</div>
          <button onClick={onClose} style={{ background: "none", border: "none" }}><X size={20} /></button>
        </div>

        {["client", "tel", "produit", "montant", "zone"].map((field) => (
          <div key={field} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#6B7168", display: "block", marginBottom: 4, textTransform: "capitalize" }}>
              {field === "tel" ? "Téléphone" : field === "montant" ? "Montant (FCFA)" : field}
            </label>
            <input
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              type={field === "montant" ? "number" : "text"}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #DDD8CC", fontSize: 14, background: "white" }}
            />
          </div>
        ))}

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
      <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 18 }}>{clients.length} client{clients.length > 1 ? "s" : ""} au total</div>

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
              <div style={{ fontWeight: 600, fontSize: 15 }}>{c.nom}</div>
              <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{c.tel} · {c.zone}</div>
              <div style={{ fontSize: 12, marginTop: 5, display: "flex", gap: 10 }}>
                <span style={{ color: "#1a7a3c" }}>{c.confirmees} livrée{c.confirmees > 1 ? "s" : ""}</span>
                {c.echouees > 0 && <span style={{ color: "#D64933" }}>{c.echouees} échouée{c.echouees > 1 ? "s" : ""}</span>}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 15 }}>{c.total}</div>
              <div style={{ fontSize: 10.5, color: "#8A9089" }}>commande{c.total > 1 ? "s" : ""}</div>
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

function LivreursView({ livreurs, onDelete }) {
  const maxTaux = Math.max(...livreurs.map((l) => l.taux ?? 0), 1);
  const medailles = ["🥇", "🥈", "🥉"];

  return (
    <div style={{ padding: "20px 20px 8px" }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, marginBottom: 4 }}>Livreurs</div>
      <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 18 }}>{livreurs.length} livreur{livreurs.length > 1 ? "s" : ""} · classés par taux de réussite</div>

      {livreurs.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#8A9089", fontSize: 14 }}>Aucun livreur ajouté. Appuie sur "+" pour en ajouter un.</div>
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
              <button onClick={() => onDelete(l.id)} style={{ background: "none", border: "none", color: "#D64933", padding: 6 }} aria-label="Retirer">
                <Trash2 size={17} />
              </button>
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
          </div>
        ))}
      </div>
    </div>
  );
}

function total_ok(l) {
  return l.total > 0;
}

function AddLivreur({ onClose, onAdd }) {
  const [form, setForm] = useState({ nom: "", telephone: "", zone: "" });
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

function TodayView({ todo, onSelectOrder }) {
  const sections = [
    { key: "aRelivrer", title: "📅 À relivrer aujourd'hui", items: todo.aRelivrer, color: "#1a7a3c", bg: "#EAF3DE" },
    { key: "jamaisContactees", title: "🆕 Jamais contactées", items: todo.jamaisContactees, color: "#8A6412", bg: "#FBF3E3" },
    { key: "sansNouvelles", title: "⏰ Sans nouvelles depuis 24h+", items: todo.sansNouvelles, color: "#D64933", bg: "#FBEAE6" },
  ];

  return (
    <div style={{ padding: "20px 20px 8px" }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 22, marginBottom: 4 }}>Aujourd'hui</div>
      <div style={{ fontSize: 13, color: "#6B7168", marginBottom: 18 }}>
        {todo.total > 0 ? `${todo.total} commande${todo.total > 1 ? "s" : ""} à traiter` : "Rien à traiter, tout est à jour ✅"}
      </div>

      {todo.total === 0 && (
        <div style={{ textAlign: "center", padding: "50px 20px", color: "#8A9089" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
          <div style={{ fontSize: 14 }}>Aucune commande urgente pour le moment.</div>
        </div>
      )}

      {sections.map((sec) =>
        sec.items.length > 0 ? (
          <div key={sec.key} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: sec.color }}>
              {sec.title} ({sec.items.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sec.items.map((o) => (
                <button
                  key={o.id}
                  onClick={() => onSelectOrder(o)}
                  style={{ textAlign: "left", background: "white", border: "1px solid #ECE8DC", borderLeft: `4px solid ${sec.color}`, borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{o.client}</div>
                    <div style={{ fontSize: 12.5, color: "#6B7168", marginTop: 2 }}>{o.produit} · {o.tel}</div>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 14.5 }}>{formatFCFA(o.montant)}</div>
                </button>
              ))}
            </div>
          </div>
        ) : null
      )}
    </div>
  );
}
