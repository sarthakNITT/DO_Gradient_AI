import crypto from "crypto";
import { execSync } from "child_process";

const WEBHOOK_SECRET: string = process.env.WEBHOOK_SECRET || "";
const REPO: string = process.env.REPO || ".";
const DO_TOKEN: string = process.env.DO_TOKEN || "";
const DO_APP_ID: string = process.env.DO_APP_ID || "";
const FAILURE_CHECK_URL: string =
    process.env.FAILURE_CHECK_URL || "http://localhost:8081";
const POLL_INTERVAL_MS: number =
    parseInt(process.env.POLL_INTERVAL_MS || "300000", 10);

interface DODeployment {
    id: string;
    phase: string;
    cause: string;
    created_at: string;
    updated_at: string;
    progress?: {
        error_steps?: number;
    };
}

interface DODeploymentsResponse {
    deployments: DODeployment[];
}

async function checkDeployments(): Promise<void> {
    if (!DO_TOKEN || !DO_APP_ID) {
        console.warn(
            "[DO Poller] DO_TOKEN or DO_APP_ID not configured – skipping poll."
        );
        return;
    }

    const url = `https://api.digitalocean.com/v2/apps/${DO_APP_ID}/deployments`;

    try {
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${DO_TOKEN}`,
                "Content-Type": "application/json",
            },
        });

        if (!res.ok) {
            console.error(
                `[DO Poller] HTTP ${res.status} ${res.statusText} when fetching deployments.`
            );
            return;
        }

        const data = (await res.json()) as DODeploymentsResponse;
        const deployments = data.deployments ?? [];

        if (deployments.length === 0) {
            console.log("[DO Poller] No deployments found.");
            return;
        }

        const failed = deployments.filter(
            (d) =>
                d.phase === "ERROR" ||
                d.phase === "FAILED" ||
                (d.progress?.error_steps ?? 0) > 0
        );

        if (failed.length === 0) {
            console.log(
                `[DO Poller] ✅ All ${deployments.length} deployment(s) healthy.`
            );
        } else {
            console.error(
                `[DO Poller] ❌ ${failed.length} FAILED deployment(s) detected!`
            );
            for (const d of failed) {
                console.error(
                    `           ID: ${d.id} | Phase: ${d.phase} | Cause: ${d.cause} | Updated: ${d.updated_at}`
                );
                triggerFailureCheck(d.id);
            }
        }
    } catch (err) {
        console.error("[DO Poller] Unexpected error during poll:", err);
    }
}

function startPolling(): void {
    console.log(
        `[DO Poller] Starting – polling every ${POLL_INTERVAL_MS / 1000}s for app "${DO_APP_ID}"`
    );
    checkDeployments();
    setInterval(checkDeployments, POLL_INTERVAL_MS);
}

function triggerFailureCheck(deploymentId: string): void {
    const url = `${FAILURE_CHECK_URL}/analyse`;
    console.log(
        `[DO Poller] → Triggering failure_check for deployment ${deploymentId}`
    );
    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deployment_id: deploymentId }),
    })
        .then((res) => {
            if (!res.ok) {
                console.error(
                    `[DO Poller] failure_check responded ${res.status}`
                );
            } else {
                console.log(`[DO Poller] ✓ failure_check analysis queued (202)`);
            }
        })
        .catch((err) =>
            console.error("[DO Poller] Could not reach failure_check:", err)
        );
}

function verifySignature(body: string, signature: string | null): boolean {
    if (!signature) return false;
    const expected =
        "sha1=" +
        crypto
            .createHmac("sha1", WEBHOOK_SECRET)
            .update(body)
            .digest("hex");
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
    );
}

async function handleWebhook(req: Request): Promise<Response> {
    const body = await req.text();
    const signature = req.headers.get("x-hub-signature");

    if (!verifySignature(body, signature)) {
        console.warn("[Webhook] ⚠️  Invalid signature – request ignored.");
        return new Response("Forbidden", { status: 403 });
    }

    console.log("[Webhook] ✅ Valid GitHub webhook received – pulling latest.");

    try {
        execSync(`cd ${REPO} && git pull`, { stdio: "inherit" });
    } catch (err) {
        console.error("[Webhook] git pull failed:", err);
        return new Response("git pull failed", { status: 500 });
    }

    return new Response("OK");
}

const server = Bun.serve({
    port: parseInt(process.env.PORT || "8080", 10),
    routes: {
        "/": (req) => handleWebhook(req),
        "/health": () => new Response("OK"),
    },
    fetch(req) {
        return new Response("Not Found", { status: 404 });
    },
});

console.log(`[Server] Listening at ${server.url}`);
startPolling();