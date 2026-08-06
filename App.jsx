import React, { useState, useEffect, useMemo } from "react";
import { Phone, MessageCircle, MessageSquare, Plus, ChevronLeft, X, Check } from "lucide-react";
import { supabase } from "./supabaseClient";

const STATUS = {
  confirmee: { label: "Confirmée", color: "#1F9D6E", bg: "#EAF7F1" },
  en_cours: { label: "En cours", color: "#E8A93D", bg: "#FBF3E3" },
  echouee: { label: "Échouée", color: "#D64933", bg: "#FBEAE6" },
};

function formatFCFA(n) {
  return Number(n).toLocaleString("fr-FR").replace(/,/g, " ") + " F";
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
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState("toutes");
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  async function loadOrders() {
    const { data, error } = await supabase
      .from("commandes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setError(error.message);
    } else {
      setOrders(data || []);
      setError(null);
    }
    setLoaded(true);
  }

  useEffect(() => {
    loadOrders();
    // Rafraîchit automatiquement toutes les 15s pour voir les changements du closer
    const interval = setInterval(loadOrders, 15000);
    return () => clearInterval(interval);
  }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  const stats = useMemo(() => {
    const confirmees = orders.filter((o) => o.statut === "confirmee");
    const echouees = orders.filter((o) => o.statut === "echouee");
    const recupere = orders.reduce((sum, o) => sum + (o.recupere ? Number(o.montant) : 0), 0);
    const tauxLivraison = orders.length ? Math.round((confirmees.length / orders.length) * 100) : 0;
    return { recupere, aRisque: echouees.length + orders.filter((o) => o.statut === "en_cours").length, tauxLivraison, total: orders.length };
  }, [orders]);

  const filtered = useMemo(() => {
    if (filter === "toutes") return orders;
    return orders.filter((o) => o.statut === filter);
  }, [orders, filter]);

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
          <div style={{ fontSize: 13, marginTop: 10 }}>
            Vérifie que VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont bien réglés dans les variables d'environnement.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#FAFAF7", minHeight: "100vh", fontFamily: "'IBM Plex Sans', sans-serif", color: "#16231F", paddingBottom: 40 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        * { box-sizing: border-box; }
        button { font-family: inherit; cursor: pointer; }
      `}</style>

      <div style={{ background: "#0F3D3E", color: "#FAFAF7", padding: "28px 20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: 20, letterSpacing: "-0.01em" }}>
            RECU<span style={{ color: "#E8A93D" }}>VENTE</span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Azali Express</div>
        </div>

        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 12, opacity: 0.75, letterSpacing: "0.04em", textTransform: "uppercase" }}>Argent récupéré</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 38, marginTop: 4, color: "#E8A93D" }}>
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
              border: "1px solid " + (filter === f.key ? "#0F3D3E" : "#DDD8CC"),
              background: filter === f.key ? "#0F3D3E" : "white",
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

      <div style={{ padding: "8px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#8A9089", fontSize: 14 }}>
            Aucune commande dans ce filtre.
          </div>
        )}
        {filtered.map((o) => {
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

      <button
        onClick={() => setShowAdd(true)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: "#0F3D3E",
          color: "white",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 6px 18px rgba(15,61,62,0.35)",
        }}
        aria-label="Ajouter une commande"
      >
        <Plus size={24} />
      </button>

      {toast && (
        <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: "#16231F", color: "white", padding: "9px 18px", borderRadius: 999, fontSize: 13, fontWeight: 500 }}>
          {toast}
        </div>
      )}

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} onStatus={updateStatus} />}
      {showAdd && <AddOrder onClose={() => setShowAdd(false)} onAdd={addOrder} />}
    </div>
  );
}

function OrderDetail({ order, onClose, onStatus }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", maxHeight: "88vh", overflowY: "auto", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
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
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 20, marginTop: 6, color: "#0F3D3E" }}>{formatFCFA(order.montant)}</div>
        </div>

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
          <a href={`sms:${order.tel}?body=${encodeURIComponent(smsMsg(order))}`} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#0F3D3E", color: "white", padding: "12px 0", borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: "none" }}>
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(22,35,31,0.5)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#FAFAF7", width: "100%", borderRadius: "18px 18px 0 0", padding: "18px 20px 28px" }}>
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
          style={{ width: "100%", marginTop: 6, padding: "13px 0", borderRadius: 10, border: "none", background: canSubmit ? "#0F3D3E" : "#DDD8CC", color: "white", fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Check size={17} /> Ajouter la commande
        </button>
      </div>
    </div>
  );
}
