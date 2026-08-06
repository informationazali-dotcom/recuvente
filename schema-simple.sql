-- Schéma simplifié RecuVente — version partagée équipe (toi + closer)
-- Colle ceci dans Supabase → SQL Editor → Run

create extension if not exists "uuid-ossp";

create table commandes (
  id uuid primary key default uuid_generate_v4(),
  client text not null,
  tel text not null,
  produit text not null,
  montant numeric not null,
  zone text,
  statut text default 'en_cours' check (statut in ('confirmee', 'en_cours', 'echouee')),
  derniere_tentative text,
  recupere boolean default false,
  created_at timestamptz default now()
);

-- Autorise la lecture et l'écriture avec la clé publique (anon)
-- Adapté pour un usage interne équipe restreinte (toi + closer), pas grand public
alter table commandes enable row level security;

create policy "acces_equipe_lecture" on commandes
  for select using (true);

create policy "acces_equipe_ecriture" on commandes
  for insert with check (true);

create policy "acces_equipe_modif" on commandes
  for update using (true);
