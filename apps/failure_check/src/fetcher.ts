import type { FailedDeployment, DeploymentStep, FailureReport } from "./types.ts";

const DO_BASE = "https://api.digitalocean.com/v2";

function doHeaders(token: string): Record<string, string> {
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}

async function doGet<T>(url: string, token: string): Promise<T> {
    const res = await fetch(url, { headers: doHeaders(token) });
    if (!res.ok) {
        throw new Error(`DO API ${res.status} ${res.statusText} — ${url}`);
    }
    return (await res.json()) as T;
}

interface LogsResponse {
    live_url?: string;
    historic_urls?: string[];
}

async function fetchLogText(
    appId: string,
    deploymentId: string,
    logType: "BUILD" | "RUN",
    token: string
): Promise<string> {
    const url =
        `${DO_BASE}/apps/${appId}/deployments/${deploymentId}/logs` +
        `?type=${logType}&live_updates=false`;

    let logResp: LogsResponse;
    try {
        logResp = await doGet<LogsResponse>(url, token);
    } catch (err) {
        console.warn(`[Fetcher] Could not fetch ${logType} logs:`, err);
        return "";
    }

    const archiveUrl = logResp.historic_urls?.[0] ?? logResp.live_url;

    if (!archiveUrl) {
        return "";
    }

    try {
        const raw = await fetch(archiveUrl);
        return await raw.text();
    } catch (err) {
        console.warn(
            `[Fetcher] Could not download ${logType} log archive:`,
            err
        );
        return "";
    }
}

function collectFailedSteps(
    steps: DeploymentStep[] | undefined,
    acc: DeploymentStep[] = []
): DeploymentStep[] {
    if (!steps) return acc;
    for (const step of steps) {
        if (step.status === "ERROR" || step.status === "FAILED") {
            acc.push(step);
        }
        collectFailedSteps(step.steps, acc);
    }
    return acc;
}

function extractExitCodes(steps: DeploymentStep[]): Record<string, number> {
    const codes: Record<string, number> = {};
    for (const step of steps) {
        const msg = step.reason?.message ?? step.message_base ?? "";
        const match = /exit\s+(?:status|code)\s+(\d+)/i.exec(msg);
        if (match?.[1]) {
            codes[step.name] = parseInt(match[1], 10);
        }
    }
    return codes;
}

interface DeploymentDetailResponse {
    deployment: FailedDeployment;
}

async function fetchDeploymentDetail(
    appId: string,
    deploymentId: string,
    token: string
): Promise<FailedDeployment> {
    const url = `${DO_BASE}/apps/${appId}/deployments/${deploymentId}`;
    const data = await doGet<DeploymentDetailResponse>(url, token);
    return data.deployment;
}

export async function fetchFailureData(
    appId: string,
    deploymentId: string,
    token: string
): Promise<Omit<FailureReport, "classified" | "affectedFiles">> {
    console.log(
        `[Fetcher] Fetching failure data for deployment ${deploymentId}…`
    );

    const [deployment, buildLogs, runtimeLogs] = await Promise.all([
        fetchDeploymentDetail(appId, deploymentId, token),
        fetchLogText(appId, deploymentId, "BUILD", token),
        fetchLogText(appId, deploymentId, "RUN", token),
    ]);

    const allSteps = deployment.progress?.steps ?? [];
    const failedSteps = collectFailedSteps(allSteps);
    const exitCodes = extractExitCodes(failedSteps);

    console.log(
        `[Fetcher] ✓ Build log: ${buildLogs.length} chars | Run log: ${runtimeLogs.length} chars | Failed steps: ${failedSteps.length}`
    );

    return { deployment, buildLogs, runtimeLogs, failedSteps, exitCodes };
}
