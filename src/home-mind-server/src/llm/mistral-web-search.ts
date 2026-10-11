
const MISTRAL_CONVERSATIONS_URL = "https://api.mistral.ai/v1/conversations";

type MistralOutputContent = {
  type?: string;
  text?: string;
  title?: string;
  url?: string;
  source?: string;
};

type MistralOutput = {
  type?: string;
  content?: string | MistralOutputContent[];
};

type MistralConversationResponse = {
  outputs?: MistralOutput[];
  conversation_id?: string;
  detail?: string;
  message?: string;
};

export type MistralWebSearchResult = {
  query: string;
  answer: string;
  sources: Array<{
    title: string;
    url: string;
  }>;
};

function getApiKey(): string {
  // MISTRAL_API_KEY est recommandé.
  // OPENAI_API_KEY peut aussi être utilisé si c'est le nom
  // de variable déjà employé pour la clé Mistral dans Home Mind.
  const apiKey =
    process.env.MISTRAL_API_KEY ??
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Clé API manquante : définis MISTRAL_API_KEY dans l'environnement."
    );
  }

  return apiKey;
}

function getModel(): string {
  return (
    process.env.MISTRAL_WEB_SEARCH_MODEL ??
    process.env.LLM_MODEL ??
    "mistral-small-latest"
  );
}

function extractOutputs(
  response: MistralConversationResponse
): MistralWebSearchResult["sources"] & string[] {
  const answerParts: string[] = [];
  const sources: Array<{ title: string; url: string }> = [];

  for (const output of response.outputs ?? []) {
    if (output.type !== "message.output") {
      continue;
    }

    if (typeof output.content === "string") {
      answerParts.push(output.content);
      continue;
    }

    for (const item of output.content ?? []) {
      if (item.type === "text" && item.text) {
        answerParts.push(item.text);
      }

      if (item.type === "tool_reference" && item.url) {
        sources.push({
          title: item.title || item.url,
          url: item.url,
        });
      }
    }
  }

  // Déduplique les références, tout en conservant leur ordre.
  const uniqueSources = sources.filter(
    (source, index, all) =>
      all.findIndex((candidate) => candidate.url === source.url) === index
  );

  // Le type de retour est interne à ce fichier : on conserve
  // les deux valeurs sans dépendre du SDK Mistral.
  return Object.assign(answerParts, {
    sources: uniqueSources,
  }) as unknown as MistralWebSearchResult["sources"] & string[];
}

/**
 * Effectue une recherche Web avec l'outil natif de Mistral.
 *
 * Cette fonction est appelée par l'outil Home Mind "web_search".
 */
export async function searchMistralWeb(
  query: string
): Promise<MistralWebSearchResult> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error("La requête de recherche Web est vide.");
  }

  if (normalizedQuery.length > 2000) {
    throw new Error(
      "La requête de recherche Web ne doit pas dépasser 2000 caractères."
    );
  }

  const response = await fetch(MISTRAL_CONVERSATIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getModel(),
      inputs: [
        {
          role: "user",
          content:
            `Recherche sur le Web et réponds en français à la question suivante. ` +
            `Utilise des informations récentes si nécessaire et cite les sources ` +
            `pertinentes avec leurs URL.\n\nQuestion : ${normalizedQuery}`,
        },
      ],
      tools: [{ type: "web_search" }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const rawBody = await response.text();

  let data: MistralConversationResponse;

  try {
    data = JSON.parse(rawBody) as MistralConversationResponse;
  } catch {
    throw new Error(
      `Réponse Mistral illisible (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    const details = data.detail ?? data.message ?? rawBody;

    throw new Error(
      `La recherche Web Mistral a échoué (HTTP ${response.status}) : ${details}`
    );
  }

  const outputParts: string[] = [];
  const sources: Array<{ title: string; url: string }> = [];

  for (const output of data.outputs ?? []) {
    if (output.type !== "message.output") {
      continue;
    }

    if (typeof output.content === "string") {
      outputParts.push(output.content);
      continue;
    }

    for (const item of output.content ?? []) {
      if (item.type === "text" && item.text) {
        outputParts.push(item.text);
      } else if (item.type === "tool_reference" && item.url) {
        sources.push({
          title: item.title || item.url,
          url: item.url,
        });
      }
    }
  }

  const uniqueSources = sources.filter(
    (source, index, all) =>
      all.findIndex((candidate) => candidate.url === source.url) === index
  );

  const answer = outputParts.join("\n").trim();

  if (!answer) {
    throw new Error(
      "Mistral a répondu sans texte exploitable pour la recherche Web."
    );
  }

  return {
    query: normalizedQuery,
    answer,
    sources: uniqueSources,
  };
}
