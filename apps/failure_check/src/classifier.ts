import type { ClassifiedLine, ErrorCategory } from "./types.ts";

interface Rule {
    category: ErrorCategory;
    patterns: RegExp[];
}

const RULES: Rule[] = [
    {
        category: "DEPENDENCY_ERROR",
        patterns: [
            /cannot find module/i,
            /module not found/i,
            /peer dependency/i,
            /failed to resolve/i,
            /npm (err|warn|error)/i,
            /yarn error/i,
            /package.*not found/i,
            /unable to resolve dependency/i,
            /dependency resolution failed/i,
            /could not resolve.*from/i,
        ],
    },
    {
        category: "MISSING_ENV",
        patterns: [
            /env(?:ironment)?\s+variable.*(?:missing|not set|undefined|required)/i,
            /(?:missing|undefined|not set)\s+(?:env(?:ironment)?\s+var|process\.env)/i,
            /process\.env\.\w+.*(?:undefined|null)/i,
            /required\s+env(?:ironmental)?\s+(?:var|variable)/i,
            /cannot read (?:propert(?:y|ies) of undefined).*env/i,
        ],
    },
    {
        category: "COMPILATION_ERROR",
        patterns: [
            /typescript(?:\scompil(?:ation|er))?\s+error/i,
            /\bts\d{4}\b/,
            /(?:compilation|build)\s+error/i,
            /syntax\s+error/i,
            /unexpected\s+token/i,
            /failed\s+to\s+compile/i,
            /tsc\s+(?:exit(?:ed)?|failed)/i,
            /babel.*transform.*error/i,
            /error\s+ts\d+:/i,
            /type\s+error:/i,
        ],
    },
    {
        category: "TEST_FAILURE",
        patterns: [
            /\d+\s+(?:test|spec)s?\s+failed/i,
            /test\s+(?:suite|run)\s+failed/i,
            /jest.*FAIL/,
            /vitest.*FAIL/i,
            /assertion\s+(?:error|failed)/i,
            /expect(?:ed|ation)\s+(?:received|failed)/i,
            /test.*failed.*\d+/i,
            /passing.*failing/i,
        ],
    },
    {
        category: "RUNTIME_EXCEPTION",
        patterns: [
            /UnhandledPromiseRejection/i,
            /uncaught\s+(?:exception|error)/i,
            /segmentation\s+fault/i,
            /signal\s+(?:sigkill|sigsegv|sigterm)/i,
            /out\s+of\s+memory/i,
            /heap\s+out\s+of\s+memory/i,
            /(?:fatal|critical|panic)[\s:]+error/i,
            /process\s+exited\s+with\s+code\s+[^0]/i,
            /runtime\s+error/i,
            /error:\s+spawn\s+\S+\s+ENOENT/i,
        ],
    },
    {
        category: "BUILD_FAILURE",
        patterns: [
            /build\s+(?:failed|error)/i,
            /error\s+during\s+build/i,
            /failed\s+to\s+build/i,
            /makefile.*error/i,
            /docker(?:file)?\s+build.*failed/i,
            /exit\s+code\s+[^0\s]/i,
            /exit\s+status\s+[^0\s]/i,
            /^error:/i,
            /\berror\b.*\bfailed\b/i,
        ],
    },
];

const FILE_RE =
    /(?:^|[\s('"])([./]?(?:[\w-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|env|py|go|rb|sh|Dockerfile))/g;

function extractFiles(line: string): string[] {
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = FILE_RE.exec(line)) !== null) {
        if (m[1]) found.add(m[1]);
    }
    FILE_RE.lastIndex = 0;
    return [...found];
}

export function classifyLogs(
    buildLogs: string,
    runtimeLogs: string
): ClassifiedLine[] {
    const combined = [
        ...buildLogs.split("\n").map((l) => ({ src: "BUILD", line: l })),
        ...runtimeLogs.split("\n").map((l) => ({ src: "RUN", line: l })),
    ];

    const results: ClassifiedLine[] = [];

    for (const { line } of combined) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        for (const rule of RULES) {
            if (rule.patterns.some((p) => p.test(trimmed))) {
                results.push({
                    category: rule.category,
                    line: trimmed,
                    files: extractFiles(trimmed),
                });
                break;
            }
        }
    }

    return results;
}

export function collectAffectedFiles(classified: ClassifiedLine[]): string[] {
    const paths = new Set<string>();
    for (const cl of classified) {
        for (const f of cl.files) paths.add(f);
    }
    return [...paths].sort();
}

export function groupByCategory(
    classified: ClassifiedLine[]
): Partial<Record<ErrorCategory, ClassifiedLine[]>> {
    const groups: Partial<Record<ErrorCategory, ClassifiedLine[]>> = {};
    for (const cl of classified) {
        (groups[cl.category] ??= []).push(cl);
    }
    return groups;
}
