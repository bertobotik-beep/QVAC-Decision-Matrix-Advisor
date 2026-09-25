// QVAC Decision Matrix Advisor — core logic.
// Scores each option against each criterion (1-10), then asks the model
// for a final recommendation grounded in the computed scores.

import { completion } from "@qvac/sdk";

async function askModel(modelId, system, user, opts) {
  const run = completion({
    modelId,
    history: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    stream: true,
    completionOpts: opts,
  });
  let text = "";
  for await (const token of run.tokenStream) text += token;
  return text.trim();
}

function parseScores(raw, criteria) {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const scores = {};
  for (const criterion of criteria) {
    let found = null;
    for (const line of lines) {
      const escaped = criterion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`${escaped}\\s*:?\\s*-?\\s*(\\d{1,2})`, "i");
      const m = line.match(re);
      if (m) { found = Math.max(1, Math.min(10, parseInt(m[1], 10))); break; }
    }
    if (found === null) {
      // fallback: try to find any "N/10" or standalone number near the criterion's position
      const idx = criteria.indexOf(criterion);
      const numMatch = lines[idx] && lines[idx].match(/(\d{1,2})/);
      found = numMatch ? Math.max(1, Math.min(10, parseInt(numMatch[1], 10))) : 5;
    }
    scores[criterion] = found;
  }
  return scores;
}

export async function generate(modelId, body) {
  const options = (body.options || []).map((o) => o.trim()).filter(Boolean);
  const criteria = (body.criteria || []).map((c) => c.trim()).filter(Boolean);

  if (options.length < 2) return { error: "Please enter at least 2 options." };
  if (criteria.length < 2) return { error: "Please enter at least 2 criteria." };

  const criteriaList = criteria.map((c) => `${c}: <score 1-10>`).join("\n");
  const exampleCriteria = criteria.map((c) => `${c}: 7`).join("\n");

  const matrix = [];
  for (const option of options) {
    const raw = await askModel(
      modelId,
      `You are helping score one option in a decision. Given the option and a list of criteria, rate the option from 1 (poor) to 10 (excellent) on EACH criterion, based only on realistic, common-sense judgment about the option itself. Reply with ONLY one line per criterion, in this exact format:\n${criteriaList}\n\nExample:\nOption: a used car with 150,000 miles\nCriteria: reliability, cost\n${exampleCriteria}`,
      `Option: ${option}\nCriteria: ${criteria.join(", ")}`,
      { temperature: 0.4, maxTokens: 150 }
    );
    const scores = parseScores(raw, criteria);
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    matrix.push({ option, scores, total });
  }

  const ranked = [...matrix].sort((a, b) => b.total - a.total);
  const summaryLines = matrix
    .map((row) => `${row.option}: ${criteria.map((c) => `${c}=${row.scores[c]}`).join(", ")} (total ${row.total})`)
    .join("\n");

  const winner = ranked[0];
  const runnerUp = ranked[1];
  const allowedCriteria = criteria.join(", ");
  const recommendation = await askModel(
    modelId,
    `You are a decision advisor. You will be told exactly which option has the highest total score — you MUST recommend that exact option and no other. The ONLY criteria that exist are: ${allowedCriteria}. Never mention any criterion outside that exact list. Write 2-3 sentences explaining why the winner comes out ahead, citing its actual per-criterion scores given below, framed as a lean ('X seems like the strongest choice because...'), not a command.`,
    `Options and scores (1-10 per criterion):\n${summaryLines}\n\nWINNER (highest total, you must recommend this one): ${winner.option} (total ${winner.total})\nRunner-up: ${runnerUp.option} (total ${runnerUp.total})\n\nExplain why ${winner.option} comes out ahead, using only these criteria: ${allowedCriteria}.`,
    { temperature: 0.3, maxTokens: 160 }
  );

  let cleanRec = recommendation.replace(/^(here'?s|here is)[^:\n]*:\s*/i, "").trim();
  const mentionsWinner = cleanRec.toLowerCase().includes(winner.option.toLowerCase().slice(0, 12));
  const mentionsOther = options.some(
    (o) => o !== winner.option && cleanRec.toLowerCase().includes(o.toLowerCase()) && !cleanRec.toLowerCase().includes(winner.option.toLowerCase())
  );
  const quotedTerms = [...cleanRec.matchAll(/'([a-zA-Z][a-zA-Z /-]{2,30})'/g)].map((m) => m[1].toLowerCase());
  const fabricatedCriterion = quotedTerms.some((t) => !criteria.some((c) => c.toLowerCase().includes(t) || t.includes(c.toLowerCase())));
  if (!cleanRec || !mentionsWinner || mentionsOther || fabricatedCriterion) {
    const scoreStr = criteria.map((c) => `${c} ${winner.scores[c]}/10`).join(", ");
    cleanRec = `${winner.option} seems like the strongest choice, leading with a total score of ${winner.total} (${scoreStr}), ahead of ${runnerUp.option} at ${runnerUp.total}.`;
  }

  return {
    criteria,
    matrix,
    topOption: winner.option,
    recommendation: cleanRec,
  };
}
