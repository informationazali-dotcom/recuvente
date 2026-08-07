import { useState } from "react";

export default function App() {
  const [stats] = useState({
    recupere: 125000,
    total: 42,
    livrees: 30,
    aRisque: 5,
  });

  return (
    <div>

      {/* HEADER */}
      <div className="header">
        <h1>Dashboard</h1>
        <div className="button">+ Nouvelle commande</div>
      </div>

      {/* CARDS */}
      <div className="grid">
        <Card title="Revenus" value={stats.recupere} />
        <Card title="Commandes" value={stats.total} />
        <Card title="Livrées" value={stats.livrees} />
        <Card title="Risque" value={stats.aRisque} />
      </div>

      {/* TABLE */}
      <div className="table">
        <h2>Commandes</h2>
        <Row />
        <Row />
        <Row />
      </div>

    </div>
  );
}

function Card({ title, value }) {
  return (
    <div className="card">
      <p>{title}</p>
      <h2>{value}</h2>
    </div>
  );
}

function Row() {
  return (
    <div className="row">
      <div>Client</div>
      <div>Produit</div>
      <div>Status</div>
    </div>
  );
}
