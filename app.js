"use strict";

const $ = selector => document.querySelector(selector);

const API_BASE = (
    window.JOB_HUNTER_CONFIG?.API_BASE || ""
)
    .trim()
    .replace(/\/+$/, "");

let currentJobs = [];
let currentProfile = null;
let cvMatchMode = false;


// ============================================================
// SKILL KNOWLEDGE BASE
// ============================================================

const SKILLS = [
    "Azure",
    "AWS",
    "Google Cloud",
    "Intune",
    "Entra ID",
    "Active Directory",
    "Microsoft 365",
    "Office 365",
    "Defender",
    "Microsoft Defender",
    "Conditional Access",
    "Autopilot",
    "PowerShell",
    "Terraform",
    "Kubernetes",
    "Docker",
    "Linux",
    "Windows Server",
    "Windows 11",
    "Exchange Online",
    "SharePoint",
    "Teams",
    "Purview",
    "Sentinel",
    "SIEM",
    "SOC",
    "DevOps",
    "Azure DevOps",
    "GitHub",
    "Git",
    "Python",
    "JavaScript",
    "TypeScript",
    "React",
    "Angular",
    "Vue",
    "Node.js",
    "C#",
    ".NET",
    "Java",
    "PHP",
    "Laravel",
    "SQL",
    "MySQL",
    "PostgreSQL",
    "SQL Server",
    "MongoDB",
    "Redis",
    "REST",
    "REST API",
    "GraphQL",
    "API",
    "CI/CD",
    "Jenkins",
    "Ansible",
    "VMware",
    "Hyper-V",
    "Citrix",
    "ServiceNow",
    "Jira",
    "Confluence",
    "Cisco",
    "Networking",
    "TCP/IP",
    "DNS",
    "DHCP",
    "VPN",
    "Firewall",
    "Cyber Security",
    "Cybersecurity",
    "ISO 27001",
    "Cyber Essentials",
    "OWASP",
    "SaaS",
    "PaaS",
    "IaaS",
    "RBAC",
    "SSO",
    "MFA",
    "OAuth",
    "SAML",
    "Zero Trust",
    "MDM",
    "MAM",
    "Endpoint Management",
    "Identity Management",
    "IAM",
    "Application Insights",
    "Log Analytics",
    "Azure Monitor",
    "Cloudflare",
    "D1",
    "Workers"
];


// ============================================================
// CERTIFICATION PATTERNS
// ============================================================

const CERT_PATTERNS = [
    /\bAZ-\d{3}\b/gi,
    /\bMS-\d{3}\b/gi,
    /\bMD-\d{3}\b/gi,
    /\bSC-\d{3}\b/gi,
    /\bAI-\d{3}\b/gi,
    /\bDP-\d{3}\b/gi,
    /\bPL-\d{3}\b/gi,
    /\bCCNA\b/gi,
    /\bCCNP\b/gi,
    /\bCISSP\b/gi,
    /\bCISM\b/gi,
    /\bCISA\b/gi,
    /\bCompTIA\s+(?:A\+|Network\+|Security\+|CySA\+)\b/gi,
    /\bITIL(?:\s+\w+)?\b/gi
];


// ============================================================
// GENERIC ROLE PATTERNS
// ============================================================

const ROLE_PATTERNS = [
    /(?:senior\s+)?cloud\s+engineer/gi,
    /(?:senior\s+)?azure\s+engineer/gi,
    /(?:senior\s+)?devops\s+engineer/gi,
    /(?:senior\s+)?software\s+engineer/gi,
    /(?:senior\s+)?software\s+developer/gi,
    /(?:senior\s+)?systems?\s+administrator/gi,
    /(?:senior\s+)?systems?\s+engineer/gi,
    /(?:senior\s+)?network\s+engineer/gi,
    /(?:senior\s+)?security\s+engineer/gi,
    /(?:senior\s+)?endpoint\s+engineer/gi,
    /(?:senior\s+)?support\s+engineer/gi,
    /(?:senior\s+)?technical\s+support/gi,
    /(?:senior\s+)?application\s+support/gi,
    /(?:senior\s+)?platform\s+engineer/gi,
    /(?:senior\s+)?infrastructure\s+engineer/gi,
    /(?:senior\s+)?data\s+engineer/gi,
    /(?:senior\s+)?data\s+analyst/gi,
    /(?:senior\s+)?business\s+analyst/gi,
    /(?:senior\s+)?project\s+manager/gi,
    /(?:senior\s+)?product\s+manager/gi,
    /(?:senior\s+)?account\s+manager/gi,
    /(?:senior\s+)?sales\s+manager/gi,
    /(?:senior\s+)?marketing\s+manager/gi,
    /(?:senior\s+)?finance\s+manager/gi,
    /(?:senior\s+)?operations\s+manager/gi,
    /(?:senior\s+)?qa\s+engineer/gi,
    /(?:senior\s+)?test\s+engineer/gi
];


// ============================================================
// HELPERS
// ============================================================

function esc(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        c => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[c]
    );
}


function unique(values) {
    return [...new Set(
        values
            .map(v => String(v).trim())
            .filter(Boolean)
    )];
}


function splitList(value) {
    return unique(
        String(value || "")
            .split(/[,;\n]/)
            .map(v => v.trim())
    );
}


function safeUrl(value) {

    try {

        const url = new URL(value);

        if (
            url.protocol !== "https:" &&
            url.protocol !== "http:"
        ) {
            return "#";
        }

        return url.href;

    } catch {
        return "#";
    }
}


function money(value) {

    const number = Number(value);

    if (!Number.isFinite(number) || number <= 0) {
        return null;
    }

    return new Intl.NumberFormat(
        "en-GB",
        {
            style: "currency",
            currency: "GBP",
            maximumFractionDigits: 0
        }
    ).format(number);
}


function formatSalary(job) {

    const min = money(job.salaryMin);
    const max = money(job.salaryMax);

    if (min && max) {

        if (
            Number(job.salaryMin) ===
            Number(job.salaryMax)
        ) {
            return min;
        }

        return `${min} – ${max}`;
    }

    if (min) return `From ${min}`;

    if (max) return `Up to ${max}`;

    return job.salary || "Salary not listed";
}


function formatDate(value) {

    if (!value) {
        return "Date not listed";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleDateString(
        "en-GB",
        {
            day: "numeric",
            month: "short",
            year: "numeric"
        }
    );
}


function normalise(value) {

    return String(value || "")
        .toLowerCase()
        .replace(/&amp;/g, "and")
        .replace(/[^a-z0-9+#.\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


// ============================================================
// MODE SWITCHING
// ============================================================

$("#searchModeBtn").addEventListener(
    "click",
    () => setMode("search")
);

$("#cvModeBtn").addEventListener(
    "click",
    () => setMode("cv")
);


function setMode(mode) {

    const cv = mode === "cv";

    $("#searchMode").hidden = cv;
    $("#cvMode").hidden = !cv;

    $("#searchModeBtn").classList.toggle(
        "active",
        !cv
    );

    $("#cvModeBtn").classList.toggle(
        "active",
        cv
    );

    cvMatchMode = cv;

    $("#sort").querySelector(
        'option[value="match"]'
    ).hidden = !cv;

    if (!cv && $("#sort").value === "match") {
        $("#sort").value = "newest";
    }
}


// ============================================================
// CV PANEL NAVIGATION
// ============================================================

function showCvPanel(panel) {

    [
        "#cvStart",
        "#uploadPanel",
        "#virtualPanel",
        "#profilePanel"
    ].forEach(
        selector => {
            $(selector).hidden = true;
        }
    );

    $(panel).hidden = false;
}


$("#uploadChoice").addEventListener(
    "click",
    () => showCvPanel("#uploadPanel")
);

$("#virtualChoice").addEventListener(
    "click",
    () => showCvPanel("#virtualPanel")
);

$("#uploadBack").addEventListener(
    "click",
    () => showCvPanel("#cvStart")
);

$("#virtualBack").addEventListener(
    "click",
    () => showCvPanel("#cvStart")
);

$("#restartCvBtn").addEventListener(
    "click",
    () => {

        currentProfile = null;

        $("#cvFile").value = "";

        showCvPanel("#cvStart");
    }
);


// ============================================================
// CV FILE UPLOAD
// ============================================================

$("#cvFile").addEventListener(
    "change",
    async event => {

        const file = event.target.files?.[0];

        if (!file) return;

        await processCvFile(file);
    }
);


const dropZone = $("#dropZone");


["dragenter", "dragover"].forEach(
    eventName => {

        dropZone.addEventListener(
            eventName,
            event => {

                event.preventDefault();

                dropZone.classList.add(
                    "dragging"
                );
            }
        );
    }
);


["dragleave", "drop"].forEach(
    eventName => {

        dropZone.addEventListener(
            eventName,
            event => {

                event.preventDefault();

                dropZone.classList.remove(
                    "dragging"
                );
            }
        );
    }
);


dropZone.addEventListener(
    "drop",
    async event => {

        const file =
            event.dataTransfer.files?.[0];

        if (!file) return;

        await processCvFile(file);
    }
);


async function processCvFile(file) {

    clearError();

    const maxBytes =
        5 * 1024 * 1024;

    if (file.size > maxBytes) {

        showError(
            "CV must be 5 MB or smaller."
        );

        return;
    }


    const extension =
        file.name
            .split(".")
            .pop()
            ?.toLowerCase();


    if (
        extension !== "pdf" &&
        extension !== "docx"
    ) {

        showError(
            "Please upload a PDF or DOCX file."
        );

        return;
    }


    $("#cvProcessing").hidden = false;


    try {

        let text = "";

        if (extension === "pdf") {
            text = await extractPdf(file);
        }

        if (extension === "docx") {
            text = await extractDocx(file);
        }


        if (
            !text ||
            text.trim().length < 80
        ) {

            throw new Error(
                "We couldn't extract enough text from this CV. If it is a scanned PDF, try a DOCX version or use the virtual CV."
            );
        }


        currentProfile =
            analyseCv(text);


        populateProfile(
            currentProfile
        );


        showCvPanel(
            "#profilePanel"
        );


    } catch (error) {

        console.error(error);

        showError(
            error.message ||
            "Unable to analyse this CV."
        );

    } finally {

        $("#cvProcessing").hidden = true;
    }
}


// ============================================================
// PDF EXTRACTION
// ============================================================

async function extractPdf(file) {

    const pdfjsLib =
        await import(
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs"
        );

    pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";


    const buffer =
        await file.arrayBuffer();


    const pdf =
        await pdfjsLib
            .getDocument({
                data: buffer
            })
            .promise;


    const pages = [];


    for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages;
        pageNumber++
    ) {

        const page =
            await pdf.getPage(
                pageNumber
            );

        const content =
            await page.getTextContent();

        pages.push(
            content.items
                .map(item => item.str)
                .join(" ")
        );
    }


    return pages.join("\n");
}


// ============================================================
// DOCX EXTRACTION
// ============================================================

async function extractDocx(file) {

    if (!window.mammoth) {

        throw new Error(
            "DOCX parser did not load. Refresh the page and try again."
        );
    }


    const buffer =
        await file.arrayBuffer();


    const result =
        await window.mammoth.extractRawText({
            arrayBuffer: buffer
        });


    return result.value || "";
}


// ============================================================
// CV ANALYSIS
// ============================================================

function analyseCv(text) {

    const cleanText =
        String(text)
            .replace(/\s+/g, " ")
            .trim();


    const lower =
        cleanText.toLowerCase();


    const skills =
        SKILLS.filter(
            skill =>
                lower.includes(
                    skill.toLowerCase()
                )
        );


    const certifications = [];

    for (
        const pattern of CERT_PATTERNS
    ) {

        const matches =
            cleanText.match(pattern);

        if (matches) {
            certifications.push(
                ...matches
            );
        }
    }


    const roles = [];

    for (
        const pattern of ROLE_PATTERNS
    ) {

        const matches =
            cleanText.match(pattern);

        if (matches) {
            roles.push(
                ...matches
            );
        }
    }


    const cleanedRoles =
        unique(roles)
            .map(title =>
                title
                    .replace(/\s+/g, " ")
                    .trim()
            );


    const years =
        estimateExperienceYears(
            cleanText
        );


    const seniority =
        inferSeniority(
            cleanText,
            cleanedRoles
        );


    let primaryRole =
        cleanedRoles[0] || "";


    if (!primaryRole) {

        primaryRole =
            inferRoleFromSkills(
                skills
            );
    }


    return {
        primaryRole,
        roles: cleanedRoles,
        skills: unique(skills),
        certifications:
            unique(
                certifications.map(
                    cert =>
                        cert.toUpperCase()
                )
            ),
        years,
        seniority
    };
}


// ============================================================
// EXPERIENCE ESTIMATION
// ============================================================

function estimateExperienceYears(text) {

    const explicit =
        [
            ...text.matchAll(
                /\b(\d{1,2})\+?\s+years?(?:\s+of)?\s+experience\b/gi
            )
        ]
        .map(
            match =>
                Number(match[1])
        )
        .filter(
            value =>
                value >= 0 &&
                value <= 60
        );


    if (explicit.length) {

        return Math.max(
            ...explicit
        );
    }


    const years =
        [
            ...text.matchAll(
                /\b(19\d{2}|20\d{2})\b/g
            )
        ]
        .map(
            match =>
                Number(match[1])
        )
        .filter(
            year =>
                year >= 1980 &&
                year <= new Date().getFullYear()
        );


    if (!years.length) {
        return 0;
    }


    const earliest =
        Math.min(...years);


    return Math.min(
        60,
        Math.max(
            0,
            new Date().getFullYear() -
            earliest
        )
    );
}


// ============================================================
// SENIORITY
// ============================================================

function inferSeniority(
    text,
    roles
) {

    const value =
        normalise(
            `${roles.join(" ")} ${text}`
        );


    if (
        /\b(head|director|manager)\b/.test(
            value
        )
    ) {
        return "manager";
    }


    if (
        /\b(lead|principal|architect)\b/.test(
            value
        )
    ) {
        return "lead";
    }


    if (
        /\bsenior\b/.test(
            value
        )
    ) {
        return "senior";
    }


    if (
        /\b(junior|graduate|trainee|apprentice)\b/.test(
            value
        )
    ) {
        return "junior";
    }


    return "mid";
}


// ============================================================
// ROLE INFERENCE
// ============================================================

function inferRoleFromSkills(skills) {

    const set =
        new Set(
            skills.map(
                skill =>
                    skill.toLowerCase()
            )
        );


    if (
        set.has("intune") ||
        set.has("autopilot") ||
        set.has("endpoint management")
    ) {
        return "Endpoint Engineer";
    }


    if (
        set.has("azure") &&
        (
            set.has("terraform") ||
            set.has("devops") ||
            set.has("docker")
        )
    ) {
        return "Cloud Engineer";
    }


    if (
        set.has("azure")
    ) {
        return "Azure Engineer";
    }


    if (
        set.has("cyber security") ||
        set.has("cybersecurity") ||
        set.has("siem")
    ) {
        return "Security Engineer";
    }


    if (
        set.has("react") ||
        set.has("javascript") ||
        set.has("typescript")
    ) {
        return "Software Developer";
    }


    return "IT Engineer";
}


// ============================================================
// VIRTUAL CV
// ============================================================

$("#virtualForm").addEventListener(
    "submit",
    event => {

        event.preventDefault();

        currentProfile = {

            primaryRole:
                $("#virtualTitle")
                    .value
                    .trim(),

            roles:
                splitList(
                    $("#virtualPreviousRoles")
                        .value
                ),

            skills:
                splitList(
                    $("#virtualSkills")
                        .value
                ),

            certifications:
                splitList(
                    $("#virtualCerts")
                        .value
                ),

            years:
                Number(
                    $("#virtualYears")
                        .value
                ) || 0,

            seniority:
                $("#virtualSeniority")
                    .value
        };


        populateProfile(
            currentProfile
        );


        showCvPanel(
            "#profilePanel"
        );
    }
);


// ============================================================
// PROFILE EDITOR
// ============================================================

function populateProfile(profile) {

    $("#profilePrimaryRole").value =
        profile.primaryRole || "";

    $("#profileRoles").value =
        (profile.roles || []).join(", ");

    $("#profileSkills").value =
        (profile.skills || []).join(", ");

    $("#profileCerts").value =
        (profile.certifications || [])
            .join(", ");

    $("#profileYears").value =
        profile.years || 0;

    $("#profileSeniority").value =
        profile.seniority || "mid";
}


function readProfileEditor() {

    return {

        primaryRole:
            $("#profilePrimaryRole")
                .value
                .trim(),

        roles:
            splitList(
                $("#profileRoles")
                    .value
            ),

        skills:
            splitList(
                $("#profileSkills")
                    .value
            ),

        certifications:
            splitList(
                $("#profileCerts")
                    .value
            ),

        years:
            Number(
                $("#profileYears")
                    .value
            ) || 0,

        seniority:
            $("#profileSeniority")
                .value
    };
}


// ============================================================
// GENERATE SEARCH QUERIES
// ============================================================

function generateSearchQueries(
    profile
) {

    const queries = [];


    if (profile.primaryRole) {

        queries.push(
            profile.primaryRole
        );
    }


    for (
        const role of profile.roles
    ) {

        if (queries.length >= 4) {
            break;
        }

        queries.push(role);
    }


    /*
     * If CV analysis only found one useful role,
     * infer additional searches from major skills.
     */

    const skillText =
        profile.skills
            .map(
                skill =>
                    skill.toLowerCase()
            );


    if (
        skillText.includes("intune")
    ) {

        queries.push(
            "Intune Engineer",
            "Endpoint Engineer"
        );
    }


    if (
        skillText.includes("azure")
    ) {

        queries.push(
            "Azure Engineer",
            "Cloud Engineer"
        );
    }


    if (
        skillText.includes("entra id") ||
        skillText.includes(
            "identity management"
        )
    ) {

        queries.push(
            "Identity Engineer"
        );
    }


    if (
        skillText.includes("devops") ||
        skillText.includes("terraform")
    ) {

        queries.push(
            "DevOps Engineer"
        );
    }


    if (
        skillText.includes("cybersecurity") ||
        skillText.includes(
            "cyber security"
        )
    ) {

        queries.push(
            "Security Engineer"
        );
    }


    return unique(queries)
        .slice(0, 5);
}


// ============================================================
// FIND CV MATCHES
// ============================================================

$("#findMatchesBtn").addEventListener(
    "click",
    async () => {

        clearError();


        const profile =
            readProfileEditor();


        if (!profile.primaryRole) {

            showError(
                "Add a primary role before searching."
            );

            return;
        }


        if (
            profile.skills.length === 0
        ) {

            showError(
                "Add at least one skill before searching."
            );

            return;
        }


        currentProfile =
            profile;


        const queries =
            generateSearchQueries(
                profile
            );


        const button =
            $("#findMatchesBtn");


        button.disabled = true;

        button.textContent =
            "Matching…";


        $("#status").textContent =
            `Searching ${queries.length} relevant role${queries.length === 1 ? "" : "s"}…`;


        try {

            const searches =
                queries.map(
                    query =>
                        searchApi({
                            query,
                            location:
                                $("#cvLocation")
                                    .value
                                    .trim(),

                            salaryMin:
                                $("#cvSalary")
                                    .value
                                    .trim(),

                            days:
                                $("#cvDays")
                                    .value,

                            limit: 20,

                            providers: [
                                "reed",
                                "adzuna"
                            ]
                        })
                );


            const responses =
                await Promise.all(
                    searches
                );


            let jobs =
                responses.flatMap(
                    response =>
                        response.jobs || []
                );


            jobs =
                deduplicateJobs(
                    jobs
                );


            jobs =
                jobs.map(
                    job => ({
                        ...job,
                        match:
                            scoreJob(
                                profile,
                                job
                            )
                    })
                );


            jobs.sort(
                (a, b) =>
                    b.match.score -
                    a.match.score
            );


            currentJobs =
                jobs;


            cvMatchMode = true;

            $("#sort").value =
                "match";


            $("#status").textContent =
                `${jobs.length} unique vacancies analysed against your CV.`;


            renderJobs();


            $("#resultsSection")
                .scrollIntoView({
                    behavior: "smooth"
                });


        } catch (error) {

            console.error(error);

            showError(
                error.message ||
                "Unable to match jobs."
            );

        } finally {

            button.disabled = false;

            button.textContent =
                "Find my matches";
        }
    }
);


// ============================================================
// API SEARCH
// ============================================================

async function searchApi({
    query,
    location = "",
    salaryMin = "",
    days = "",
    limit = 20,
    providers = ["reed", "adzuna"]
}) {

    if (!API_BASE) {

        throw new Error(
            "API_BASE is not configured."
        );
    }


    const params =
        new URLSearchParams();


    params.set(
        "q",
        query
    );

    params.set(
        "providers",
        providers.join(",")
    );

    params.set(
        "resultsPerSource",
        String(limit)
    );


    if (location) {

        params.set(
            "location",
            location
        );
    }


    if (salaryMin) {

        params.set(
            "salaryMin",
            salaryMin
        );
    }


    if (days) {

        params.set(
            "postedWithin",
            days
        );
    }


    const response =
        await fetch(
            `${API_BASE}/api/jobs/search?${params.toString()}`,
            {
                headers: {
                    Accept: "application/json"
                }
            }
        );


    const data =
        await response.json();


    if (!response.ok) {

        throw new Error(
            data.error ||
            `Search failed (${response.status}).`
        );
    }


    return data;
}


// ============================================================
// NORMAL SEARCH
// ============================================================

$("#searchForm").addEventListener(
    "submit",
    async event => {

        event.preventDefault();

        clearError();


        const query =
            $("#q")
                .value
                .trim();


        if (!query) {

            showError(
                "Enter a job title, skill or keyword."
            );

            return;
        }


        const providers =
            [
                ...document.querySelectorAll(
                    'input[name="source"]:checked'
                )
            ]
            .map(
                input =>
                    input.value
            );


        if (!providers.length) {

            showError(
                "Select at least one job source."
            );

            return;
        }


        const button =
            $("#searchBtn");


        button.disabled = true;

        button.textContent =
            "Searching…";


        $("#status").textContent =
            "Searching live vacancies…";


        try {

            const data =
                await
