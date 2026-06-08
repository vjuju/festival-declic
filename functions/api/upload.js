// Cloudflare Pages Function — POST /api/upload
//
// Reçoit une photo (multipart: champ "file") + le pageId Notion (champ "pageId"),
// puis l'attache à la propriété « Fichiers » de la fiche via l'API Notion.
//
// Flux API Notion (https://developers.notion.com/docs/uploading-small-files) :
//   1. POST /v1/file_uploads                → crée l'upload, renvoie un id
//   2. POST /v1/file_uploads/{id}/send      → envoie le contenu du fichier (multipart)
//   3. PATCH /v1/pages/{pageId}             → écrit l'id dans la propriété Fichiers
//
// Secrets / variables à définir sur le projet Cloudflare Pages :
//   - NOTION_TOKEN            (secret) : token d'une intégration interne Notion,
//                                        partagée avec la base des participants.
//   - NOTION_PHOTO_PROPERTY  (option) : nom exact de la propriété Fichiers (défaut "Photo").

const NOTION_VERSION = "2026-03-11";
const NOTION_API = "https://api.notion.com/v1";
const MAX_BYTES = 20 * 1024 * 1024; // 20 Mo (limite upload simple)

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.NOTION_TOKEN) {
    return json({ ok: false, error: "Configuration manquante (NOTION_TOKEN)." }, 500);
  }

  const propertyName = env.NOTION_PHOTO_PROPERTY || "Photo";

  // --- Lecture de la requête ---
  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ ok: false, error: "Requête invalide (multipart attendu)." }, 400);
  }

  const file = form.get("file");
  const pageId = (form.get("pageId") || "").toString().trim();

  if (!file || typeof file === "string") {
    return json({ ok: false, error: "Aucun fichier reçu." }, 400);
  }
  if (!pageId || !/^[0-9a-f]{32}$/i.test(pageId.replace(/-/g, ""))) {
    return json({ ok: false, error: "pageId invalide." }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ ok: false, error: "Fichier trop volumineux (max 20 Mo)." }, 413);
  }

  const authHeaders = {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    "Notion-Version": NOTION_VERSION,
  };

  try {
    // --- Étape 1 : créer l'objet file_upload ---
    const createRes = await fetch(`${NOTION_API}/file_uploads`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: "{}",
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      return json({ ok: false, error: notionError(createData, "création de l'upload") }, 502);
    }
    const uploadId = createData.id;

    // --- Étape 2 : envoyer le contenu du fichier ---
    const sendForm = new FormData();
    sendForm.append("file", file, file.name || "photo");
    const sendRes = await fetch(`${NOTION_API}/file_uploads/${uploadId}/send`, {
      method: "POST",
      headers: authHeaders, // pas de Content-Type : le runtime gère la frontière multipart
      body: sendForm,
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      return json({ ok: false, error: notionError(sendData, "envoi du fichier") }, 502);
    }

    // --- Étape 3 : attacher à la propriété Fichiers de la fiche ---
    const patchRes = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: "PATCH",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: {
          [propertyName]: {
            type: "files",
            files: [
              {
                type: "file_upload",
                name: file.name || "photo",
                file_upload: { id: uploadId },
              },
            ],
          },
        },
      }),
    });
    const patchData = await patchRes.json();
    if (!patchRes.ok) {
      return json({ ok: false, error: notionError(patchData, "mise à jour de la fiche") }, 502);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: "Erreur réseau côté serveur." }, 502);
  }
}

function notionError(data, step) {
  const msg = (data && (data.message || data.code)) || "erreur inconnue";
  return `Notion (${step}) : ${msg}`;
}
