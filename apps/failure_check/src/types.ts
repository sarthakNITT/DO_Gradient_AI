export interface FailedDeployment {
    id: string;
    phase: string;
    cause: string;
    created_at: string;
    updated_at: string;
    progress?: {
        error_steps?: number;
        steps?: DeploymentStep[];
    };
    services?: ComponentSpec[];
    workers?: ComponentSpec[];
    jobs?: ComponentSpec[];
    static_sites?: ComponentSpec[];
}

export interface DeploymentStep {
    name: string;
    status: string;
    reason?: {
        code?: string;
        message?: string;
    };
    steps?: DeploymentStep[];
    component_name?: string;
    message_base?: string;
}

export interface ComponentSpec {
    name: string;
}

export interface ClassifiedLine {
    category: ErrorCategory;
    line: string;
    files: string[];
}

export type ErrorCategory =
    | "BUILD_FAILURE"
    | "DEPENDENCY_ERROR"
    | "COMPILATION_ERROR"
    | "MISSING_ENV"
    | "TEST_FAILURE"
    | "RUNTIME_EXCEPTION";

export interface FailureReport {
    deployment: FailedDeployment;
    buildLogs: string;
    runtimeLogs: string;
    failedSteps: DeploymentStep[];
    exitCodes: Record<string, number>;
    classified: ClassifiedLine[];
    affectedFiles: string[];
}
