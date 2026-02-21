import { fetchFailureData } from "./fetcher.ts";
import { classifyLogs, collectAffectedFiles } from "./classifier.ts";
import { buildAndSavePrompt } from "./promptBuilder.ts";
import type { FailureReport, FailedDeployment } from "./types.ts";

const DO_TOKEN: string = process.env.DO_TOKEN ?? "";
const DO_APP_ID: string = process.env.DO_APP_ID ?? "";
const GRADIENT_AI_TOKEN: string = process.env.GRADIENT_AI_TOKEN ?? "";
const PROMPT_OUTPUT_DIR: string = process.env.PROMPT_OUTPUT_DIR ?? ".";
const PORT: number = parseInt(process.env.PORT ?? "8081", 10);

export async function analyseDeployment(deploymentId: string): Promise<string> {
    if (!DO_TOKEN || !DO_APP_ID || !GRADIENT_AI_TOKEN) {
        throw new Error(
            "Missing required env vars: DO_TOKEN, DO_APP_ID, GRADIENT_AI_TOKEN"
        );
    }

    console.log(`\n${"─".repeat(60)}`);
    console.log(`[FailureCheck] Analysing deployment: ${deploymentId}`);
    console.log(`${"─".repeat(60)}`);

    const rawData = await fetchFailureData(DO_APP_ID, deploymentId, DO_TOKEN);

    const classified = classifyLogs(rawData.buildLogs, rawData.runtimeLogs);
    const affectedFiles = collectAffectedFiles(classified);

    console.log(
        `[FailureCheck] Classified ${classified.length} lines → ${affectedFiles.length} unique file(s) referenced`
    );

    const report: FailureReport = {
        ...rawData,
        classified,
        affectedFiles,
    };

    const promptPath = await buildAndSavePrompt(
        report,
        GRADIENT_AI_TOKEN,
        PROMPT_OUTPUT_DIR
    );

    console.log(`[FailureCheck] ✅ Done — prompt at: ${promptPath}\n`);
    return promptPath;
}

interface AnalyseBody {
    deployment_id?: string;
    deployment?: FailedDeployment;
}

async function handleAnalyse(req: Request): Promise<Response> {
    if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
    }

    let body: AnalyseBody;
    try {
        body = (await req.json()) as AnalyseBody;
    } catch {
        return new Response("Invalid JSON body", { status: 400 });
    }

    const deploymentId = body.deployment_id ?? body.deployment?.id;

    if (!deploymentId) {
        return new Response(
            JSON.stringify({ error: "deployment_id is required" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    analyseDeployment(deploymentId).catch((err) => {
        console.error("[FailureCheck] Pipeline error:", err);
    });

    return new Response(
        JSON.stringify({
            message: "Analysis started",
            deployment_id: deploymentId,
        }),
        { status: 202, headers: { "Content-Type": "application/json" } }
    );
}

const server = Bun.serve({
    port: PORT,
    routes: {
        "/analyse": (req) => handleAnalyse(req),
        "/health": () => new Response("OK"),
    },
    fetch(req) {
        return new Response("Not Found", { status: 404 });
    },
});

console.log(`[FailureCheck] Server listening at ${server.url}`);
console.log(`[FailureCheck] POST /analyse { "deployment_id": "..." } to trigger analysis`);