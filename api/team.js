// Fonction Vercel pour gérer l'équipe : lister et supprimer des comptes
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return false;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return false;
  return data.user.email === process.env.VITE_ADMIN_EMAIL;
}

export default async function handler(req, res) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) {
    return res.status(403).json({ error: "Accès refusé — réservé à l'administrateur." });
  }

  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers();
      if (error) return res.status(400).json({ error: error.message });
      const users = data.users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
      }));
      return res.status(200).json({ users });
    }

    if (req.method === "DELETE") {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "userId requis" });
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
