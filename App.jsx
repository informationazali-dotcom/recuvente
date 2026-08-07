import { motion } from "framer-motion";
import { Phone, MessageCircle, Package } from "lucide-react";
import { useState } from "react";

export default function App() {
  const [stats] = useState({
    recupere: 125000,
    total: 42,
    livrees: 30,
    aRisque: 5,
  });

  return (
    <div className="min-h-screen bg-[#0B0F1A] text-white p-6">

      {/* HEADER */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Dashboard
        </h1>

        <button className="bg-white text-black px-4 py-2 rounded-xl font-medium hover:scale-105 transition">
          + Nouvelle commande
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-4 gap-6 mb-10">
        <Card title="💰 Revenus" value={`${stats.recupere} F`} />
        <Card title="📦 Commandes" value={stats.total} />
        <Card title="🚚 Livrées" value={stats.livrees} />
        <Card title="⚠️ Risque" value={stats.aRisque} />
      </div>

      {/* TABLE */}
      <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg mb-4 font-medium">Commandes récentes</h2>

        <div className="space-y-4">
          <OrderRow />
          <OrderRow />
          <OrderRow />
        </div>
      </div>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <motion.div
      whileHover={{ y: -5 }}
      className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-xl"
    >
      <p className="text-sm text-gray-400">{title}</p>
      <p className="text-2xl font-semibold mt-2">{value}</p>
    </motion.div>
  );
}

function OrderRow() {
  return (
    <div className="flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/10 hover:bg-white/10 transition">

      <div>
        <p className="font-medium">Client Exemple</p>
        <p className="text-sm text-gray-400">Produit X</p>
      </div>

      <div className="flex gap-2">
        <button className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20">
          <Phone size={16} />
        </button>
        <button className="p-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20">
          <MessageCircle size={16} />
        </button>
        <button className="p-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20">
          <Package size={16} />
        </button>
      </div>
    </div>
  );
}
