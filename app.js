"use strict";

/*
 * ============================================================
 * JOB HUNTER
 * frontend/app.js
 * ============================================================
 *
 * Modes:
 *
 * 1. Normal Job Search
 * 2. CV Match
 *    - Upload CV
 *    - Extract CV text
 *    - Build temporary candidate profile
 *    - Review/edit profile
 *    - Generate job searches
 *    - Search Reed + Adzuna
 *    - Deduplicate vacancies
 *    - Score vacancies against CV/profile
 *    - Rank by match percentage
 *
 * PRIVACY:
 *
 * - No localStorage
 * - No sessionStorage
 * - No IndexedDB
 * - No cookies
 * - No CV persistence
 * - No profile persistence
 *
 * The candidate profile exists only in JavaScript memory.
 *
 * ============================================================
 */


// ============================================================
// CONFIG
// ============================================================

const CONFIG =
    window.JOB_HUNTER_CONFIG || {};

const API_BASE =
    String(
        CONFIG.API_BASE || ""
    )
        .trim()
        .replace(/\/+$/, "");


// ============================================================
// APPLICATION STATE
// ============================================================

const state = {

    mode: "search",

    jobs: [],

    cvJobs: [],

    candidateProfile: null,

    cvText: "",

    cvFileName: "",

    generatedQueries: [],

    searching: false
};


// ============================================================
// DOM HELPERS
// ============================================================

const $ = selector =>
    document.querySelector(selector);

const $$ = selector =>
    [...document.querySelectorAll(selector)];


// ============================================================
// SAFE HTML
// ============================================================

function escapeHTML(value) {

    return String(value ?? "")
        .replace(
            /[&<>"']/g,
            character => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            })[character]
        );
}


function safeURL(value) {

    try {

        const url =
            new URL(value);

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


// ============================================================
// GENERAL HELPERS
// ============================================================

function uniqueStrings(values) {

    return [
        ...new Set(
            values
                .map(value =>
                    String(value || "").trim()
                )
                .filter(Boolean)
        )
    ];
}


function clamp(
    value,
    minimum,
    maximum
) {

    return Math.min(
        maximum,
        Math.max(
            minimum,
            value
        )
    );
}


function normaliseText(value) {

    return String(value || "")
        .toLowerCase()
        .replace(/&amp;/g, " and ")
        .replace(/[^a-z0-9+#.\-/ ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


function stripHTML(value) {

    const element =
        document.createElement("div");

    element.innerHTML =
        String(value || "");

    return (
        element.textContent ||
        element.innerText ||
        ""
    ).trim();
}


// ============================================================
// MONEY
// ============================================================

function formatMoney(value) {

    const number =
        Number(value);

    if (
        !Number.isFinite(number) ||
        number <= 0
    ) {
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

    const minimum =
        formatMoney(
            job.salaryMin
        );

    const maximum =
        formatMoney(
            job.salaryMax
        );

    if (
        minimum &&
        maximum
    ) {

        if (
            Number(job.salaryMin) ===
            Number(job.salaryMax)
        ) {
            return minimum;
        }

        return `${minimum} – ${maximum}`;
    }

    if (minimum) {
        return `From ${minimum}`;
    }

    if (maximum) {
        return `Up to ${maximum}`;
    }

    if (job.salary) {
        return String(job.salary);
    }

    return "Salary not listed";
}


// ============================================================
// DATE
// ============================================================

function parseJobDate(value) {

    if (!value) {
        return null;
    }

    const raw =
        String(value).trim();

    /*
     * Support Reed UK DD/MM/YYYY.
     */

    const ukMatch =
        raw.match(
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
        );

    if (ukMatch) {

        const day =
            Number(ukMatch[1]);

        const month =
            Number(ukMatch[2]);

        const year =
            Number(ukMatch[3]);

        const date =
            new Date(
                Date.UTC(
                    year,
                    month - 1,
                    day
                )
            );

        if (
            date.getUTCFullYear() === year &&
            date.getUTCMonth() === month - 1 &&
            date.getUTCDate() === day
        ) {
            return date;
        }

        return null;
    }

    const date =
        new Date(raw);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return null;
    }

    return date;
}


function formatDate(value) {

    const date =
        parseJobDate(value);

    if (!date) {

        return value
            ? String(value)
            : "Date not listed";
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


// ============================================================
// STATUS / ERRORS
// ============================================================

function setStatus(message) {

    const element =
        $("#status");

    if (element) {
        element.textContent =
            message || "";
    }
}


function showError(message) {

    const element =
        $("#error");

    if (!element) {

        console.error(message);

        return;
    }

    element.textContent =
        message;

    element.hidden = false;
}


function clearError() {

    const element =
        $("#error");

    if (!element) {
        return;
    }

    element.textContent = "";

    element.hidden = true;
}


// ============================================================
// PROVIDERS
// ============================================================

function getSelectedProviders() {

    const inputs =
        $$(
            'input[name="source"]:checked, input[name="provider"]:checked'
        );

    const providers =
        inputs.map(
            input =>
                String(
                    input.value
                ).toLowerCase()
        );

    return uniqueStrings(
        providers.map(
            provider => {

                if (
                    provider === "cvlib" ||
                    provider === "cv-library"
                ) {
                    return "cvlibrary";
                }

                return provider;
            }
        )
    );
}


// ============================================================
// API
// ============================================================

async function searchAPI({

    query,

    location = "",

    salaryMin = "",

    postedWithin = "",

    resultsPerSource = 20,

    providers = [
        "reed",
        "adzuna"
    ]

}) {

    if (
        !API_BASE ||
        API_BASE.includes(
            "YOUR-WORKER"
        )
    ) {

        throw new Error(
            "API_BASE is not configured in config.js."
        );
    }

    if (!query) {

        throw new Error(
            "A search query is required."
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
        String(
            resultsPerSource
        )
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

    if (postedWithin) {

        params.set(
            "postedWithin",
            postedWithin
        );
    }

    const url =
        `${API_BASE}/api/jobs/search?${params.toString()}`;

    console.log(
        "Job search:",
        url
    );

    const response =
        await fetch(
            url,
            {
                method: "GET",

                headers: {
                    Accept:
                        "application/json"
                }
            }
        );

    let payload;

    try {

        payload =
            await response.json();

    } catch {

        throw new Error(
            `Job API returned an invalid response (${response.status}).`
        );
    }

    if (!response.ok) {

        throw new Error(
            payload?.error ||
            `Job search failed (${response.status}).`
        );
    }

    return {
        jobs:
            Array.isArray(
                payload.jobs
            )
                ? payload.jobs
                : [],

        providers:
            payload.providers || {},

        count:
            Number(
                payload.count || 0
            )
    };
}


// ============================================================
// NORMAL SEARCH
// ============================================================

async function handleNormalSearch(
    event
) {

    event.preventDefault();

    clearError();

    const query =
        $("#q")?.value
            ?.trim() || "";

    if (!query) {

        showError(
            "Enter a job title, skill or keyword."
        );

        return;
    }

    let providers =
        getSelectedProviders();

    if (
        providers.length === 0
    ) {

        /*
         * Allows existing HTML without provider
         * checkboxes to continue working.
         */

        providers = [
            "reed",
            "adzuna"
        ];
    }

    const button =
        $("#searchBtn");

    try {

        state.searching = true;

        if (button) {

            button.disabled = true;

            button.textContent =
                "Searching…";
        }

        setStatus(
            "Searching job boards…"
        );

        const result =
            await searchAPI({

                query,

                location:
                    $("#location")
                        ?.value
                        ?.trim() || "",

                salaryMin:
                    $("#salaryMin")
                        ?.value
                        ?.trim() || "",

                postedWithin:
                    $("#days")
                        ?.value
                        ?.trim() ||
                    $("#postedWithin")
                        ?.value
                        ?.trim() ||
                    "",

                resultsPerSource:
                    Number(
                        $("#limit")
                            ?.value ||
                        $("#resultsPerSource")
                            ?.value ||
                        20
                    ),

                providers
            });

        state.jobs =
            deduplicateJobs(
                result.jobs
            );

        sortNormalJobs();

        renderNormalJobs();

        setStatus(
            `${state.jobs.length} unique job${
                state.jobs.length === 1
                    ? ""
                    : "s"
            } found.`
        );

    } catch (error) {

        console.error(error);

        state.jobs = [];

        showError(
            error.message ||
            "Search failed."
        );

        setStatus(
            "Search failed."
        );

    } finally {

        state.searching = false;

        if (button) {

            button.disabled = false;

            button.textContent =
                "Search jobs";
        }
    }
}


// ============================================================
// NORMAL JOB SORTING
// ============================================================

function sortNormalJobs() {

    const sort =
        $("#sort")?.value ||
        "newest";

    if (
        sort === "salary"
    ) {

        state.jobs.sort(
            (a, b) =>
                getJobSalary(b) -
                getJobSalary(a)
        );

        return;
    }

    if (
        sort === "title"
    ) {

        state.jobs.sort(
            (a, b) =>
                String(
                    a.title || ""
                ).localeCompare(
                    String(
                        b.title || ""
                    ),
                    "en-GB"
                )
        );

        return;
    }

    state.jobs.sort(
        (a, b) => {

            const aDate =
                parseJobDate(
                    a.postedAt
                );

            const bDate =
                parseJobDate(
                    b.postedAt
                );

            return (
                bDate?.getTime() || 0
            ) -
            (
                aDate?.getTime() || 0
            );
        }
    );
}


function getJobSalary(job) {

    return (
        Number(
            job.salaryMax
        ) ||
        Number(
            job.salaryMin
        ) ||
        0
    );
}


// ============================================================
// NORMAL JOB RENDER
// ============================================================

function renderNormalJobs() {

    const container =
        $("#jobs") ||
        $("#results");

    if (!container) {
        return;
    }

    if (
        state.jobs.length === 0
    ) {

        container.innerHTML = `
            <div class="empty">
                No jobs matched this search.
            </div>
        `;

        return;
    }

    container.innerHTML =
        state.jobs
            .map(
                job =>
                    createJobCard(
                        job
                    )
            )
            .join("");
}


// ============================================================
// JOB CARD
// ============================================================

function createJobCard(
    job,
    match = null
) {

    const description =
        stripHTML(
            job.description || ""
        );

    const shortDescription =
        description.length > 360
            ? `${description.slice(0, 360)}…`
            : description;

    const provider =
        job.provider ||
        job.source ||
        "Job board";

    const matchHTML =
        match
            ? createMatchSection(
                match
            )
            : "";

    return `
        <article class="job">

            ${
                match
                    ? `
                        <div class="match-score match-${getMatchClass(match.score)}">
                            <strong>
                                ${escapeHTML(match.score)}%
                            </strong>

                            <span>
                                CV MATCH
                            </span>
                        </div>
                    `
                    : ""
            }

            <div class="jobTop">

                <div>

                    <h3>
                        ${escapeHTML(
                            job.title ||
                            "Untitled job"
                        )}
                    </h3>

                    <p class="company">
                        ${escapeHTML(
                            job.company ||
                            "Company not listed"
                        )}
                    </p>

                </div>

                <a
                    href="${escapeHTML(
                        safeURL(
                            job.url
                        )
                    )}"
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                >
                    View job →
                </a>

            </div>

            <div class="meta">

                <span class="pill">
                    ${escapeHTML(
                        job.location ||
                        "Location not listed"
                    )}
                </span>

                <span class="pill">
                    ${escapeHTML(
                        formatSalary(job)
                    )}
                </span>

                <span class="pill">
                    ${escapeHTML(
                        formatDate(
                            job.postedAt
                        )
                    )}
                </span>

                <span class="pill source">
                    ${escapeHTML(
                        provider
                    )}
                </span>

                ${
                    job.remote
                        ? `
                            <span class="pill">
                                Remote
                            </span>
                        `
                        : ""
                }

                ${
                    job.contractType
                        ? `
                            <span class="pill">
                                ${escapeHTML(
                                    job.contractType
                                )}
                            </span>
                        `
                        : ""
                }

            </div>

            ${matchHTML}

            ${
                shortDescription
                    ? `
                        <p class="desc">
                            ${escapeHTML(
                                shortDescription
                            )}
                        </p>
                    `
                    : ""
            }

        </article>
    `;
}


// ============================================================
// MODE SWITCHING
// ============================================================

function initialiseModes() {

    const searchModeButton =
        $("#mode-search");

    const cvModeButton =
        $("#mode-cv");

    searchModeButton
        ?.addEventListener(
            "click",
            () =>
                switchMode(
                    "search"
                )
        );

    cvModeButton
        ?.addEventListener(
            "click",
            () =>
                switchMode(
                    "cv"
                )
        );
}


function switchMode(mode) {

    state.mode =
        mode;

    const searchPanel =
        $("#search-panel");

    const cvPanel =
        $("#cv-panel");

    const searchButton =
        $("#mode-search");

    const cvButton =
        $("#mode-cv");

    if (searchPanel) {

        searchPanel.hidden =
            mode !== "search";
    }

    if (cvPanel) {

        cvPanel.hidden =
            mode !== "cv";
    }

    searchButton
        ?.classList.toggle(
            "active",
            mode === "search"
        );

    cvButton
        ?.classList.toggle(
            "active",
            mode === "cv"
        );
}


// ============================================================
// CV UPLOAD
// ============================================================

function initialiseCVUpload() {

    const input =
        $("#cv-file");

    const dropZone =
        $("#cv-drop-zone");

    input
        ?.addEventListener(
            "change",
            async event => {

                const file =
                    event.target
                        .files?.[0];

                if (file) {

                    await handleCVFile(
                        file
                    );
                }
            }
        );


    dropZone
        ?.addEventListener(
            "dragover",
            event => {

                event.preventDefault();

                dropZone.classList.add(
                    "dragging"
                );
            }
        );


    dropZone
        ?.addEventListener(
            "dragleave",
            () => {

                dropZone.classList.remove(
                    "dragging"
                );
            }
        );


    dropZone
        ?.addEventListener(
            "drop",
            async event => {

                event.preventDefault();

                dropZone.classList.remove(
                    "dragging"
                );

                const file =
                    event.dataTransfer
                        ?.files?.[0];

                if (file) {

                    await handleCVFile(
                        file
                    );
                }
            }
        );
}


// ============================================================
// CV FILE VALIDATION
// ============================================================

async function handleCVFile(file) {

    clearError();

    const maximumSize =
        5 * 1024 * 1024;

    if (
        file.size > maximumSize
    ) {

        showError(
            "CV must be smaller than 5 MB."
        );

        return;
    }

    const extension =
        file.name
            .split(".")
            .pop()
            ?.toLowerCase();

    if (
        ![
            "pdf",
            "docx",
            "txt"
        ].includes(extension)
    ) {

        showError(
            "Please upload a PDF, DOCX or TXT CV."
        );

        return;
    }

    state.cvFileName =
        file.name;

    setCVStatus(
        `Analysing ${file.name}…`
    );

    try {

        const text =
            await extractCVText(
                file,
                extension
            );

        if (
            !text ||
            text.length < 40
        ) {

            throw new Error(
                "We could not extract enough text from this CV."
            );
        }

        state.cvText =
            text;

        state.candidateProfile =
            analyseCVText(
                text
            );

        renderCandidateProfile();

        setCVStatus(
            "CV analysed. Review your profile before searching."
        );

    } catch (error) {

        console.error(error);

        showError(
            error.message ||
            "Unable to analyse CV."
        );

        setCVStatus(
            "CV analysis failed."
        );
    }
}


// ============================================================
// CV TEXT EXTRACTION
// ============================================================

async function extractCVText(
    file,
    extension
) {

    if (
        extension === "txt"
    ) {

        return await file.text();
    }

    if (
        extension === "pdf"
    ) {

        return await extractPDFText(
            file
        );
    }

    if (
        extension === "docx"
    ) {

        return await extractDOCXText(
            file
        );
    }

    throw new Error(
        "Unsupported CV format."
    );
}


// ============================================================
// PDF EXTRACTION
// ============================================================

async function extractPDFText(file) {

    /*
     * Requires PDF.js in index.html.
     *
     * Example:
     *
     * window.pdfjsLib
     *
     * We deliberately do NOT upload the CV
     * anywhere.
     */

    if (
        !window.pdfjsLib
    ) {

        throw new Error(
            "PDF support is not loaded. Add PDF.js to index.html."
        );
    }

    const buffer =
        await file.arrayBuffer();

    const pdf =
        await window.pdfjsLib
            .getDocument({
                data:
                    new Uint8Array(
                        buffer
                    )
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

        const text =
            content.items
                .map(
                    item =>
                        item.str
                )
                .join(" ");

        pages.push(text);
    }

    return pages.join("\n");
}


// ============================================================
// DOCX EXTRACTION
// ============================================================

async function extractDOCXText(file) {

    /*
     * Requires Mammoth.js in index.html.
     */

    if (
        !window.mammoth
    ) {

        throw new Error(
            "DOCX support is not loaded. Add Mammoth.js to index.html."
        );
    }

    const buffer =
        await file.arrayBuffer();

    const result =
        await window.mammoth
            .extractRawText({
                arrayBuffer:
                    buffer
            });

    return result.value || "";
}


// ============================================================
// CV ANALYSIS
// ============================================================

const SKILL_DICTIONARY = [

    // Microsoft / Cloud

    "Azure",
    "AWS",
    "Google Cloud",
    "GCP",
    "Microsoft 365",
    "M365",
    "Office 365",
    "Intune",
    "Entra ID",
    "Azure AD",
    "Active Directory",
    "Defender",
    "Microsoft Defender",
    "Purview",
    "SharePoint",
    "Exchange",
    "Exchange Online",
    "Teams",
    "Autopilot",
    "Conditional Access",

    // DevOps

    "DevOps",
    "Azure DevOps",
    "GitHub",
    "Git",
    "Docker",
    "Kubernetes",
    "Terraform",
    "Ansible",
    "Jenkins",
    "CI/CD",
    "Bicep",

    // Development

    "JavaScript",
    "TypeScript",
    "React",
    "Angular",
    "Vue",
    "Node.js",
    "Node",
    "Python",
    "Java",
    "C#",
    ".NET",
    "PHP",
    "Laravel",
    "SQL",
    "PowerShell",
    "Bash",
    "REST API",
    "REST",
    "GraphQL",

    // Security

    "Cyber Security",
    "Cybersecurity",
    "SIEM",
    "SOC",
    "Sentinel",
    "Microsoft Sentinel",
    "Splunk",
    "Zero Trust",
    "IAM",
    "Identity",
    "RBAC",
    "MFA",
    "SSO",
    "OWASP",
    "Penetration Testing",
    "Vulnerability Management",

    // Infrastructure

    "Windows Server",
    "Linux",
    "VMware",
    "Hyper-V",
    "Networking",
    "DNS",
    "DHCP",
    "TCP/IP",
    "VPN",

    // Data

    "Power BI",
    "Excel",
    "Tableau",
    "Databricks",
    "Snowflake",

    // ITSM

    "ServiceNow",
    "Jira",
    "ITIL",

    // QA

    "QA",
    "Quality Assurance",
    "Selenium",
    "Playwright",
    "Cypress",
    "Postman",
    "API Testing"
];


const CERTIFICATION_PATTERNS = [

    /\bAZ[- ]?900\b/gi,
    /\bAZ[- ]?104\b/gi,
    /\bAZ[- ]?305\b/gi,
    /\bAZ[- ]?500\b/gi,

    /\bMD[- ]?102\b/gi,

    /\bMS[- ]?900\b/gi,
    /\bMS[- ]?102\b/gi,

    /\bSC[- ]?900\b/gi,
    /\bSC[- ]?200\b/gi,
    /\bSC[- ]?300\b/gi,
    /\bSC[- ]?400\b/gi,

    /\bAI[- ]?900\b/gi,

    /\bDP[- ]?900\b/gi,
    /\bDP[- ]?203\b/gi,

    /\bCCNA\b/gi,

    /\bCCNP\b/gi,

    /\bCISSP\b/gi,

    /\bCISM\b/gi,

    /\bCompTIA\s+Security\+?\b/gi,

    /\bSecurity\+\b/gi,

    /\bITIL\b/gi
];


function analyseCVText(text) {

    const cleanText =
        normaliseText(text);

    const skills =
        detectSkills(
            cleanText
        );

    const certifications =
        detectCertifications(
            text
        );

    const roles =
        detectRoles(
            text,
            skills
        );

    const seniority =
        detectSeniority(
            text
        );

    const experienceYears =
        estimateExperienceYears(
            text
        );

    const industries =
        detectIndustries(
            text
        );

    return {

        skills,

        certifications,

        roles,

        seniority,

        experienceYears,

        industries
    };
}


// ============================================================
// SKILL DETECTION
// ============================================================

function detectSkills(text) {

    const found = [];

    for (
        const skill of
        SKILL_DICTIONARY
    ) {

        const normalisedSkill =
            normaliseText(skill);

        const escaped =
            normalisedSkill.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );

        const pattern =
            new RegExp(
                `(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,
                "i"
            );

        if (
            pattern.test(text)
        ) {

            found.push(skill);
        }
    }

    return consolidateSkills(
        found
    );
}


function consolidateSkills(skills) {

    const aliases = {

        "M365":
            "Microsoft 365",

        "Office 365":
            "Microsoft 365",

        "Azure AD":
            "Entra ID",

        "Microsoft Defender":
            "Defender",

        "Microsoft Sentinel":
            "Sentinel",

        "Node":
            "Node.js",

        "REST":
            "REST API",

        "Cyber Security":
            "Cybersecurity"
    };

    return uniqueStrings(
        skills.map(
            skill =>
                aliases[skill] ||
                skill
        )
    );
}


// ============================================================
// CERTIFICATION DETECTION
// ============================================================

function detectCertifications(text) {

    const certifications = [];

    for (
        const pattern of
        CERTIFICATION_PATTERNS
    ) {

        const matches =
            text.match(pattern);

        if (!matches) {
            continue;
        }

        certifications.push(
            ...matches.map(
                match =>
                    match
                        .replace(
                            /\s+/g,
                            ""
                        )
                        .replace(
                            /^([A-Za-z]{2})(\d{3})$/,
                            "$1-$2"
                        )
                        .toUpperCase()
            )
        );
    }

    return uniqueStrings(
        certifications
    );
}


// ============================================================
// ROLE DETECTION
// ============================================================

function detectRoles(
    text,
    skills
) {

    const lower =
        normaliseText(text);

    const rolePatterns = [

        [
            "Cloud Engineer",
            [
                "cloud engineer",
                "azure engineer",
                "cloud administrator"
            ]
        ],

        [
            "Endpoint Engineer",
            [
                "endpoint engineer",
                "endpoint administrator",
                "intune engineer"
            ]
        ],

        [
            "Microsoft 365 Engineer",
            [
                "microsoft 365",
                "m365 engineer",
                "office 365 engineer"
            ]
        ],

        [
            "Systems Administrator",
            [
                "systems administrator",
                "system administrator",
                "sysadmin"
            ]
        ],

        [
            "DevOps Engineer",
            [
                "devops engineer",
                "devops"
            ]
        ],

        [
            "Security Engineer",
            [
                "security engineer",
                "cyber security engineer",
                "cybersecurity engineer"
            ]
        ],

        [
            "SOC Analyst",
            [
                "soc analyst",
                "security operations"
            ]
        ],

        [
            "Software Engineer",
            [
                "software engineer",
                "software developer"
            ]
        ],

        [
            "Developer",
            [
                "developer",
                "programmer"
            ]
        ],

        [
            "QA Engineer",
            [
                "qa engineer",
                "quality assurance",
                "software tester",
                "test engineer"
            ]
        ],

        [
            "IT Support Engineer",
            [
                "support engineer",
                "technical support",
                "it support"
            ]
        ]
    ];

    const roles = [];

    for (
        const [
            role,
            terms
        ] of rolePatterns
    ) {

        if (
            terms.some(
                term =>
                    lower.includes(term)
            )
        ) {

            roles.push(role);
        }
    }


    /*
     * Skill-derived role suggestions.
     */

    const skillSet =
        new Set(
            skills.map(
                skill =>
                    skill.toLowerCase()
            )
        );

    if (
        skillSet.has("intune") &&
        skillSet.has("entra id")
    ) {

        roles.push(
            "Endpoint Engineer"
        );
    }

    if (
        skillSet.has("azure")
    ) {

        roles.push(
            "Cloud Engineer"
        );
    }

    if (
        skillSet.has("microsoft 365")
    ) {

        roles.push(
            "Microsoft 365 Engineer"
        );
    }

    if (
        skillSet.has("docker") ||
        skillSet.has("kubernetes") ||
        skillSet.has("terraform")
    ) {

        roles.push(
            "DevOps Engineer"
        );
    }

    return uniqueStrings(
        roles
    ).slice(
        0,
        8
    );
}


// ============================================================
// SENIORITY
// ============================================================

function detectSeniority(text) {

    const lower =
        normaliseText(text);

    if (
        /\b(principal|head of|director|architect)\b/
            .test(lower)
    ) {
        return "senior";
    }

    if (
        /\b(senior|lead|team lead|manager)\b/
            .test(lower)
    ) {
        return "senior";
    }

    if (
        /\b(junior|graduate|trainee|apprentice)\b/
            .test(lower)
    ) {
        return "junior";
    }

    return "mid";
}


// ============================================================
// EXPERIENCE ESTIMATION
// ============================================================

function estimateExperienceYears(text) {

    const currentYear =
        new Date()
            .getFullYear();

    const yearMatches =
        [
            ...String(text)
                .matchAll(
                    /\b(19\d{2}|20\d{2})\b/g
                )
        ]
            .map(
                match =>
                    Number(
                        match[1]
                    )
            )
            .filter(
                year =>
                    year >= 1980 &&
                    year <= currentYear
            );

    if (
        yearMatches.length === 0
    ) {
        return null;
    }

    const earliest =
        Math.min(
            ...yearMatches
        );

    return clamp(
        currentYear -
        earliest,
        0,
        50
    );
}


// ============================================================
// INDUSTRY DETECTION
// ============================================================

function detectIndustries(text) {

    const lower =
        normaliseText(text);

    const map = {

        "Financial Services": [
            "banking",
            "financial services",
            "fintech",
            "insurance"
        ],

        "Healthcare": [
            "healthcare",
            "nhs",
            "clinical"
        ],

        "Public Sector": [
            "public sector",
            "government",
            "civil service"
        ],

        "Technology": [
            "technology",
            "software",
            "saas",
            "cloud"
        ],

        "Retail": [
            "retail",
            "ecommerce",
            "e-commerce"
        ],

        "Education": [
            "education",
            "university",
            "college",
            "school"
        ],

        "Telecommunications": [
            "telecom",
            "telecommunications"
        ]
    };

    const found = [];

    for (
        const [
            industry,
            terms
        ] of Object.entries(map)
    ) {

        if (
            terms.some(
                term =>
                    lower.includes(term)
            )
        ) {

            found.push(
                industry
            );
        }
    }

    return found;
}


// ============================================================
// CANDIDATE PROFILE RENDER
// ============================================================

function renderCandidateProfile() {

    const container =
        $("#candidate-profile");

    if (
        !container ||
        !state.candidateProfile
    ) {
        return;
    }

    const profile =
        state.candidateProfile;

    container.hidden = false;

    container.innerHTML = `

        <div class="profile-header">

            <div>

                <span class="eyebrow">
                    TEMPORARY PROFILE
                </span>

                <h2>
                    What we found
                </h2>

                <p>
                    Review this before we search.
                    Nothing is being saved.
                </p>

            </div>

        </div>


        ${createEditableTagSection(
            "Likely roles",
            "roles",
            profile.roles
        )}


        ${createEditableTagSection(
            "Skills",
            "skills",
            profile.skills
        )}


        ${createEditableTagSection(
            "Certifications",
            "certifications",
            profile.certifications
        )}


        ${createEditableTagSection(
            "Industries",
            "industries",
            profile.industries
        )}


        <div class="profile-field">

            <label for="profile-experience">
                Estimated experience
            </label>

            <div class="profile-inline">

                <input
                    id="profile-experience"
                    type="number"
                    min="0"
                    max="50"
                    value="${
                        profile.experienceYears ??
                        ""
                    }"
                    placeholder="Years"
                >

                <span>
                    years
                </span>

            </div>

        </div>


        <div class="profile-field">

            <label for="profile-seniority">
                Seniority
            </label>

            <select id="profile-seniority">

                <option
                    value="junior"
                    ${
                        profile.seniority ===
                        "junior"
                            ? "selected"
                            : ""
                    }
                >
                    Junior
                </option>

                <option
                    value="mid"
                    ${
                        profile.seniority ===
                        "mid"
                            ? "selected"
                            : ""
                    }
                >
                    Mid
                </option>

                <option
                    value="senior"
                    ${
                        profile.seniority ===
                        "senior"
                            ? "selected"
                            : ""
                    }
                >
                    Senior
                </option>

            </select>

        </div>


        <div class="profile-search-options">

            <label>
                Location
            </label>

            <input
                id="cv-location"
                type="text"
                placeholder="e.g. London or Remote"
            >


            <label>
                Minimum salary
            </label>

            <input
                id="cv-salary"
                type="number"
                min="0"
                step="1000"
                placeholder="e.g. 45000"
            >


            <label>
                Posted within
            </label>

            <select id="cv-days">

                <option value="">
                    Any time
                </option>

                <option value="1">
                    24 hours
                </option>

                <option value="3">
                    3 days
                </option>

                <option value="7">
                    7 days
                </option>

                <option value="14">
                    14 days
                </option>

                <option value="30">
                    30 days
                </option>

            </select>

        </div>


        <button
            id="find-cv-jobs"
            type="button"
            class="primary"
        >
            Find my jobs
        </button>

    `;

    initialiseProfileEditor();
}


// ============================================================
// EDITABLE TAGS
// ============================================================

function createEditableTagSection(
    title,
    property,
    values
) {

    return `

        <div
            class="profile-field tag-editor"
            data-property="${escapeHTML(property)}"
        >

            <label>
                ${escapeHTML(title)}
            </label>

            <div class="profile-tags">

                ${
                    values
                        .map(
                            value => `
                                <button
                                    type="button"
                                    class="profile-tag"
                                    data-remove-tag="${escapeHTML(value)}"
                                    title="Remove"
                                >
                                    ${escapeHTML(value)}
                                    <span>×</span>
                                </button>
                            `
                        )
                        .join("")
                }

            </div>

            <div class="tag-add">

                <input
                    type="text"
                    data-tag-input
                    placeholder="Add ${escapeHTML(
                        title.toLowerCase()
                    )}"
                >

                <button
                    type="button"
                    data-add-tag
                >
                    + Add
                </button>

            </div>

        </div>
    `;
}


// ============================================================
// PROFILE EDITOR EVENTS
// ============================================================

function initialiseProfileEditor() {

    $$(
        "[data-remove-tag]"
    ).forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    const section =
                        button.closest(
                            "[data-property]"
                        );

                    const property =
                        section?.dataset
                            ?.property;

                    const value =
                        button.dataset
                            .removeTag;

                    if (
                        !property ||
                        !state.candidateProfile
                    ) {
                        return;
                    }

                    state.candidateProfile[
                        property
                    ] =
                        state.candidateProfile[
                            property
                        ].filter(
                            item =>
                                item !== value
                        );

                    renderCandidateProfile();
                }
            );
        }
    );


    $$(
        "[data-add-tag]"
    ).forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    const section =
                        button.closest(
                            "[data-property]"
                        );

                    const input =
                        section
                            ?.querySelector(
                                "[data-tag-input]"
                            );

                    const property =
                        section
                            ?.dataset
                            ?.property;

                    const value =
                        input
                            ?.value
                            ?.trim();

                    if (
                        !property ||
                        !value ||
                        !state.candidateProfile
                    ) {
                        return;
                    }

                    state.candidateProfile[
                        property
                    ] =
                        uniqueStrings([
                            ...state
                                .candidateProfile[
                                    property
                                ],
                            value
                        ]);

                    renderCandidateProfile();
                }
            );
        }
    );


    $("#profile-experience")
        ?.addEventListener(
            "change",
            event => {

                const value =
                    Number(
                        event.target.value
                    );

                state.candidateProfile
                    .experienceYears =
                        Number.isFinite(value)
                            ? clamp(
                                value,
                                0,
                                50
                            )
                            : null;
            }
        );


    $("#profile-seniority")
        ?.addEventListener(
            "change",
            event => {

                state.candidateProfile
                    .seniority =
                        event.target.value;
            }
        );


    $("#find-cv-jobs")
        ?.addEventListener(
            "click",
            findCVMatchedJobs
        );
}


// ============================================================
// VIRTUAL CV
// ============================================================

function initialiseVirtualCV() {

    $("#build-virtual-cv")
        ?.addEventListener(
            "click",
            () => {

                state.candidateProfile = {

                    roles: [],

                    skills: [],

                    certifications: [],

                    industries: [],

                    seniority: "mid",

                    experienceYears: null
                };

                renderCandidateProfile();

                setCVStatus(
                    "Build your temporary profile below."
                );
            }
        );
}


// ============================================================
// CV STATUS
// ============================================================

function setCVStatus(message) {

    const element =
        $("#cv-status");

    if (element) {

        element.textContent =
            message;
    }
}


// ============================================================
// QUERY GENERATION
// ============================================================

function generateCandidateQueries(
    profile
) {

    const queries = [];

    /*
     * Role searches are strongest.
     */

    for (
        const role of
        profile.roles.slice(
            0,
            5
        )
    ) {

        queries.push(role);
    }


    /*
     * If role detection was weak,
     * construct searches from strongest skills.
     */

    if (
        queries.length < 3
    ) {

        const skills =
            profile.skills.slice(
                0,
                8
            );

        for (
            const skill of skills
        ) {

            queries.push(
                `${skill} Engineer`
            );
        }
    }


    /*
     * Last fallback.
     */

    if (
        queries.length === 0
    ) {

        queries.push(
            "IT Engineer"
        );
    }

    return uniqueStrings(
        queries
    ).slice(
        0,
        6
    );
}


// ============================================================
// FIND CV MATCHED JOBS
// ============================================================

async function findCVMatchedJobs() {

    clearError();

    if (
        !state.candidateProfile
    ) {

        showError(
            "Upload a CV or build a profile first."
        );

        return;
    }

    const button =
        $("#find-cv-jobs");

    try {

        button.disabled = true;

        button.textContent =
            "Finding matches…";

        setCVStatus(
            "Finding jobs that match your experience…"
        );

        const queries =
            generateCandidateQueries(
                state.candidateProfile
            );

        state.generatedQueries =
            queries;

        const location =
            $("#cv-location")
                ?.value
                ?.trim() || "";

        const salaryMin =
            $("#cv-salary")
                ?.value
                ?.trim() || "";

        const postedWithin =
            $("#cv-days")
                ?.value
                ?.trim() || "";

        let providers =
            getSelectedProviders();

        if (
            providers.length === 0
        ) {

            providers = [
                "reed",
                "adzuna"
            ];
        }


        /*
         * Run several targeted searches.
         *
         * Keep concurrency bounded to avoid
         * unnecessarily hammering the Worker.
         */

        const allJobs = [];

        for (
            const query of queries
        ) {

            setCVStatus(
                `Searching for ${query}…`
            );

            try {

                const result =
                    await searchAPI({

                        query,

                        location,

                        salaryMin,

                        postedWithin,

                        resultsPerSource: 20,

                        providers
                    });

                allJobs.push(
                    ...result.jobs
                );

            } catch (error) {

                console.warn(
                    `Search failed for "${query}"`,
                    error
                );
            }
        }


        const uniqueJobs =
            deduplicateJobs(
                allJobs
            );


        /*
         * Score every unique vacancy.
         */

        state.cvJobs =
            uniqueJobs
                .map(
                    job => ({

                        job,

                        match:
                            calculateJobMatch(
                                state.candidateProfile,
                                job
                            )
                    })
                )
                .filter(
                    item =>
                        item.match.score > 0
                )
                .sort(
                    (a, b) => {

                        if (
                            b.match.score !==
                            a.match.score
                        ) {

                            return (
                                b.match.score -
                                a.match.score
                            );
                        }

                        const aDate =
                            parseJobDate(
                                a.job.postedAt
                            );

                        const bDate =
                            parseJobDate(
                                b.job.postedAt
                            );

                        return (
                            bDate?.getTime() || 0
                        ) -
                        (
                            aDate?.getTime() || 0
                        );
                    }
                );


        renderCVResults();


        setCVStatus(
            `${uniqueJobs.length} unique vacancies analysed. ` +
            `${state.cvJobs.length} potential matches found.`
        );

    } catch (error) {

        console.error(error);

        showError(
            error.message ||
            "Unable to find CV matches."
        );

        setCVStatus(
            "CV matching failed."
        );

    } finally {

        button.disabled = false;

        button.textContent =
            "Find my jobs";
    }
}


// ============================================================
// DEDUPLICATION
// ============================================================

function deduplicateJobs(jobs) {

    const map =
        new Map();

    for (
        const job of jobs
    ) {

        if (
            !job ||
            !job.title ||
            !job.url
        ) {
            continue;
        }

        const key =
            [
                normaliseText(
                    job.title
                ),

                normaliseText(
                    job.company
                ),

                normaliseText(
                    job.location
                )
            ].join("|");

        if (
            !map.has(key)
        ) {

            map.set(
                key,
                job
            );

            continue;
        }

        const existing =
            map.get(key);

        /*
         * Prefer the more complete record.
         */

        const existingScore =
            getCompletenessScore(
                existing
            );

        const newScore =
            getCompletenessScore(
                job
            );

        if (
            newScore >
            existingScore
        ) {

            map.set(
                key,
                job
            );
        }
    }

    return [
        ...map.values()
    ];
}


function getCompletenessScore(job) {

    let score = 0;

    if (job.title) score++;
    if (job.company) score++;
    if (job.location) score++;
    if (job.description) score += 2;
    if (job.salaryMin) score++;
    if (job.salaryMax) score++;
    if (job.postedAt) score++;
    if (job.contractType) score++;
    if (job.remote) score++;

    return score;
}


// ============================================================
// MATCHING ENGINE
// ============================================================

function calculateJobMatch(
    profile,
    job
) {

    const jobText =
        normaliseText(
            [
                job.title,
                job.description,
                job.company,
                job.contractType,
                job.location
            ].join(" ")
        );


    // --------------------------------------------------------
    // SKILLS
    // 40 points
    // --------------------------------------------------------

    const matchedSkills = [];

    const missingSkills = [];

    for (
        const skill of
        profile.skills
    ) {

        if (
            textContainsSkill(
                jobText,
                skill
            )
        ) {

            matchedSkills.push(
                skill
            );

        } else {

            missingSkills.push(
                skill
            );
        }
    }

    const skillRatio =
        profile.skills.length
            ? matchedSkills.length /
              profile.skills.length
            : 0;

    const skillScore =
        skillRatio * 40;


    // --------------------------------------------------------
    // EXPERIENCE RELEVANCE
    // 20 points
    // --------------------------------------------------------

    const experienceScore =
        calculateExperienceScore(
            profile,
            jobText
        );


    // --------------------------------------------------------
    // ROLE SIMILARITY
    // 15 points
    // --------------------------------------------------------

    const roleResult =
        calculateRoleScore(
            profile,
            job
        );


    // --------------------------------------------------------
    // SENIORITY
    // 10 points
    // --------------------------------------------------------

    const seniorityResult =
        calculateSeniorityScore(
            profile,
            jobText
        );


    // --------------------------------------------------------
    // CERTIFICATIONS
    // 5 points
    // --------------------------------------------------------

    const certificationResult =
        calculateCertificationScore(
            profile,
            jobText
        );


    // --------------------------------------------------------
    // INDUSTRY
    // 5 points
    // --------------------------------------------------------

    const industryResult =
        calculateIndustryScore(
            profile,
            jobText
        );


    // --------------------------------------------------------
    // LOCATION / WORK MODEL
    // 5 points
    // --------------------------------------------------------

    const locationScore =
        job.remote
            ? 5
            : 3;


    // --------------------------------------------------------
    // FINAL
    // --------------------------------------------------------

    const rawScore =
        skillScore +
        experienceScore +
        roleResult.score +
        seniorityResult.score +
        certificationResult.score +
        industryResult.score +
        locationScore;

    const score =
        clamp(
            Math.round(
                rawScore
            ),
            0,
            100
        );


    /*
     * Detect important vacancy skills not
     * present in candidate profile.
     */

    const vacancySkills =
        detectSkills(
            jobText
        );

    const candidateSkillsNormalised =
        new Set(
            profile.skills.map(
                skill =>
                    normaliseText(skill)
            )
        );

    const gaps =
        vacancySkills
            .filter(
                skill =>
                    !candidateSkillsNormalised
                        .has(
                            normaliseText(
                                skill
                            )
                        )
            )
            .slice(
                0,
                6
            );


    return {

        score,

        matchedSkills:
            matchedSkills.slice(
                0,
                8
            ),

        gaps,

        matchedCertifications:
            certificationResult.matches,

        roleMatch:
            roleResult.match,

        seniorityMatch:
            seniorityResult.match,

        industryMatches:
            industryResult.matches,

        explanation:
            buildMatchExplanation({

                score,

                matchedSkills,

                gaps,

                roleMatch:
                    roleResult.match,

                seniorityMatch:
                    seniorityResult.match,

                certifications:
                    certificationResult.matches
            })
    };
}


// ============================================================
// SKILL MATCH
// ============================================================

function textContainsSkill(
    text,
    skill
) {

    const aliases = {

        "Microsoft 365": [
            "microsoft 365",
            "m365",
            "office 365",
            "o365"
        ],

        "Entra ID": [
            "entra id",
            "azure ad",
            "azure active directory"
        ],

        "Defender": [
            "defender",
            "microsoft defender"
        ],

        "Sentinel": [
            "sentinel",
            "microsoft sentinel"
        ],

        "REST API": [
            "rest api",
            "restful",
            "api"
        ],

        "Node.js": [
            "node.js",
            "nodejs"
        ],

        "Cybersecurity": [
            "cybersecurity",
            "cyber security"
        ]
    };

    const terms =
        aliases[skill] ||
        [
            normaliseText(
                skill
            )
        ];

    return terms.some(
        term =>
            text.includes(
                normaliseText(
                    term
                )
            )
    );
}


// ============================================================
// EXPERIENCE SCORE
// ============================================================

function calculateExperienceScore(
    profile,
    jobText
) {

    const years =
        Number(
            profile.experienceYears
        );

    if (
        !Number.isFinite(years)
    ) {

        return 10;
    }

    const requirements =
        [
            ...jobText.matchAll(
                /\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/gi
            )
        ]
            .map(
                match =>
                    Number(
                        match[1]
                    )
            )
            .filter(
                value =>
                    value <= 20
            );

    if (
        requirements.length === 0
    ) {

        return 15;
    }

    const required =
        Math.min(
            ...requirements
        );

    if (
        years >= required
    ) {

        return 20;
    }

    const ratio =
        years /
        required;

    return clamp(
        ratio * 20,
        0,
        20
    );
}


// ============================================================
// ROLE SCORE
// ============================================================

function calculateRoleScore(
    profile,
    job
) {

    const title =
        normaliseText(
            job.title
        );

    let bestScore = 0;

    let bestRole = null;

    for (
        const role of
        profile.roles
    ) {

        const normalisedRole =
            normaliseText(role);

        if (
            title ===
            normalisedRole
        ) {

            return {
                score: 15,
                match: role
            };
        }

        if (
            title.includes(
                normalisedRole
            ) ||
            normalisedRole.includes(
                title
            )
        ) {

            if (
                bestScore < 13
            ) {

                bestScore = 13;

                bestRole = role;
            }

            continue;
        }

        const roleWords =
            normalisedRole
                .split(" ")
                .filter(
                    word =>
                        word.length > 2
                );

        const matches =
            roleWords.filter(
                word =>
                    title.includes(word)
            ).length;

        if (
            matches > 0
        ) {

            const score =
                clamp(
                    (
                        matches /
                        roleWords.length
                    ) * 12,
                    0,
                    12
                );

            if (
                score >
                bestScore
            ) {

                bestScore =
                    score;

                bestRole =
                    role;
            }
        }
    }

    return {

        score:
            bestScore,

        match:
            bestRole
    };
}


// ============================================================
// SENIORITY SCORE
// ============================================================

function calculateSeniorityScore(
    profile,
    jobText
) {

    let jobLevel =
        "mid";

    if (
        /\b(principal|lead|senior|head|director|architect)\b/
            .test(jobText)
    ) {

        jobLevel =
            "senior";

    } else if (
        /\b(junior|graduate|trainee|apprentice)\b/
            .test(jobText)
    ) {

        jobLevel =
            "junior";
    }

    if (
        profile.seniority ===
        jobLevel
    ) {

        return {
            score: 10,
            match: true
        };
    }

    const levels = {

        junior: 1,
        mid: 2,
        senior: 3
    };

    const difference =
        Math.abs(
            levels[
                profile.seniority
            ] -
            levels[
                jobLevel
            ]
        );

    if (
        difference === 1
    ) {

        return {
            score: 6,
            match: false
        };
    }

    return {
        score: 2,
        match: false
    };
}


// ============================================================
// CERTIFICATION SCORE
// ============================================================

function calculateCertificationScore(
    profile,
    jobText
) {

    if (
        profile.certifications
            .length === 0
    ) {

        return {
            score: 0,
            matches: []
        };
    }

    const matches =
        profile.certifications
            .filter(
                certification =>
                    jobText.includes(
                        normaliseText(
                            certification
                        )
                    )
            );

    if (
        matches.length === 0
    ) {

        return {
            score: 0,
            matches: []
        };
    }

    return {

        score: 5,

        matches
    };
}


// ============================================================
// INDUSTRY SCORE
// ============================================================

function calculateIndustryScore(
    profile,
    jobText
) {

    if (
        profile.industries
            .length === 0
    ) {

        return {
            score: 0,
            matches: []
        };
    }

    const matches =
        profile.industries
            .filter(
                industry =>
                    jobText.includes(
                        normaliseText(
                            industry
                        )
                    )
            );

    return {

        score:
            matches.length
                ? 5
                : 0,

        matches
    };
}


// ============================================================
// MATCH EXPLANATION
// ============================================================

function buildMatchExplanation({

    score,

    matchedSkills,

    gaps,

    roleMatch,

    seniorityMatch,

    certifications

}) {

    const parts = [];

    if (
        roleMatch
    ) {

        parts.push(
            `The vacancy aligns with your ${roleMatch} experience.`
        );
    }

    if (
        matchedSkills.length
    ) {

        parts.push(
            `${matchedSkills.length} relevant skill${
                matchedSkills.length === 1
                    ? ""
                    : "s"
            } from your profile appear in the vacancy.`
        );
    }

    if (
        seniorityMatch
    ) {

        parts.push(
            "The advertised seniority aligns with your profile."
        );
    }

    if (
        certifications.length
    ) {

        parts.push(
            "Relevant certifications are also mentioned."
        );
    }

    if (
        gaps.length
    ) {

        parts.push(
            `Potential gaps include ${gaps
                .slice(0, 3)
                .join(", ")}.`
        );
    }

    if (
        parts.length === 0
    ) {

        if (
            score >= 70
        ) {

            return "Strong overall alignment with your CV.";

        }

        return "Some elements of this vacancy align with your CV.";
    }

    return parts.join(" ");
}


// ============================================================
// MATCH RESULT RENDERING
// ============================================================

function renderCVResults() {

    const container =
        $("#cv-results") ||
        $("#jobs") ||
        $("#results");

    if (!container) {
        return;
    }

    if (
        state.cvJobs.length === 0
    ) {

        container.innerHTML = `

            <div class="empty">

                <h3>
                    No strong matches found
                </h3>

                <p>
                    Try widening the location,
                    salary or date filters.
                </p>

            </div>
        `;

        return;
    }

    container.innerHTML =
        state.cvJobs
            .map(
                item =>
                    createJobCard(
                        item.job,
                        item.match
                    )
            )
            .join("");
}


// ============================================================
// MATCH DETAILS
// ============================================================

function createMatchSection(
    match
) {

    return `

        <div class="match-details">

            ${
                match.matchedSkills.length
                    ? `
                        <div class="match-group">

                            <strong>
                                Matched
                            </strong>

                            <div class="match-tags matched">

                                ${match.matchedSkills
                                    .map(
                                        skill => `
                                            <span>
                                                ✓ ${escapeHTML(skill)}
                                            </span>
                                        `
                                    )
                                    .join("")}

                            </div>

                        </div>
                    `
                    : ""
            }


            ${
                match.gaps.length
                    ? `
                        <div class="match-group">

                            <strong>
                                Potential gaps
                            </strong>

                            <div class="match-tags gaps">

                                ${match.gaps
                                    .map(
                                        skill => `
                                            <span>
                                                △ ${escapeHTML(skill)}
                                            </span>
                                        `
                                    )
                                    .join("")}

                            </div>

                        </div>
                    `
                    : ""
            }


            <p class="match-explanation">
                ${escapeHTML(
                    match.explanation
                )}
            </p>


            <small class="match-disclaimer">
                Match score measures CV-to-vacancy alignment,
                not your likelihood of being hired.
            </small>

        </div>
    `;
}


function getMatchClass(score) {

    if (
        score >= 80
    ) {
        return "excellent";
    }

    if (
        score >= 65
    ) {
        return "strong";
    }

    if (
        score >= 50
    ) {
        return "possible";
    }

    return "weak";
}


// ============================================================
// CLEAR CV
// ============================================================

function clearCVData() {

    /*
     * Explicitly remove all candidate information
     * from application memory.
     */

    state.cvText = "";

    state.cvFileName = "";

    state.candidateProfile = null;

    state.cvJobs = [];

    state.generatedQueries = [];

    const input =
        $("#cv-file");

    if (input) {

        input.value = "";
    }

    const profile =
        $("#candidate-profile");

    if (profile) {

        profile.innerHTML = "";

        profile.hidden = true;
    }

    const results =
        $("#cv-results");

    if (results) {

        results.innerHTML = "";
    }

    setCVStatus(
        "CV cleared."
    );
}


// ============================================================
// APPLICATION INITIALISATION
// ============================================================

function initialiseApp() {

    console.log(
        "Job Hunter initialising…"
    );


    // --------------------------------------------------------
    // Existing normal search
    // --------------------------------------------------------

    const searchForm =
        $("#searchForm") ||
        $("#search-form");

    searchForm
        ?.addEventListener(
            "submit",
            handleNormalSearch
        );


    // --------------------------------------------------------
    // Sort
    // --------------------------------------------------------

    $("#sort")
        ?.addEventListener(
            "change",
            () => {

                if (
                    state.mode ===
                    "search"
                ) {

                    sortNormalJobs();

                    renderNormalJobs();
                }
            }
        );


    // --------------------------------------------------------
    // Modes
    // --------------------------------------------------------

    initialiseModes();


    // --------------------------------------------------------
    // CV
    // --------------------------------------------------------

    initialiseCVUpload();

    initialiseVirtualCV();


    // --------------------------------------------------------
    // Clear CV
    // --------------------------------------------------------

    $("#clear-cv")
        ?.addEventListener(
            "click",
            clearCVData
        );


    console.log(
        "Job Hunter ready."
    );
}


// ============================================================
// START
// ============================================================

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initialiseApp
    );

} else {

    initialiseApp();
}
