/*
 * Job Hunter
 * frontend/app.js
 *
 * Dynamic multi-provider job search frontend.
 * GitHub Pages -> Cloudflare Worker -> Job providers.
 *
 * SECURITY:
 * - No provider API keys belong in this file.
 * - All third-party API calls go through the Cloudflare Worker.
 * - User-supplied/API-supplied text is rendered with textContent.
 */

"use strict";

// ============================================================
// 1. CONFIGURATION
// ============================================================

const CONFIG = window.JOB_HUNTER_CONFIG || {};

const API_BASE = String(CONFIG.API_BASE || "")
    .trim()
    .replace(/\/+$/, "");


// ============================================================
// 2. DOM REFERENCES
// ============================================================

const searchForm = document.getElementById("search-form");

const queryInput = document.getElementById("query");
const locationInput = document.getElementById("location");
const salaryInput = document.getElementById("salary-min");
const postedWithinInput = document.getElementById("posted-within");
const resultsPerSourceInput = document.getElementById("results-per-source");

const providerInputs = Array.from(
    document.querySelectorAll('input[name="provider"]')
);

const searchButton = document.getElementById("search-button");

const resultsSection = document.getElementById("results-section");
const resultsContainer = document.getElementById("results");
const resultsCount = document.getElementById("results-count");

const sortSelect = document.getElementById("sort");

const statusMessage = document.getElementById("status-message");


// ============================================================
// 3. APPLICATION STATE
// ============================================================

let currentResults = [];
let activeRequestController = null;


// ============================================================
// 4. INITIALISE
// ============================================================

document.addEventListener("DOMContentLoaded", init);

function init() {
    if (!searchForm) {
        console.error("Job Hunter: #search-form was not found.");
        return;
    }

    searchForm.addEventListener("submit", handleSearch);

    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            renderResults(sortResults(currentResults));
        });
    }

    restoreSearchFromURL();
}


// ============================================================
// 5. SEARCH HANDLER
// ============================================================

async function handleSearch(event) {
    event.preventDefault();

    clearStatus();

    const search = getSearchValues();

    if (!validateSearch(search)) {
        return;
    }

    if (!API_BASE) {
        showStatus(
            "The API URL has not been configured. Add your Cloudflare Worker URL to config.js.",
            "error"
        );
        return;
    }

    // Cancel the previous search if the user searches again quickly.
    if (activeRequestController) {
        activeRequestController.abort();
    }

    activeRequestController = new AbortController();

    setLoading(true);
    updateBrowserURL(search);

    try {
        const params = buildSearchParams(search);

        const response = await fetch(
            `${API_BASE}/api/jobs/search?${params.toString()}`,
            {
                method: "GET",
                headers: {
                    Accept: "application/json"
                },
                signal: activeRequestController.signal
            }
        );

        const payload = await readJSONResponse(response);

        if (!response.ok) {
            throw new Error(
                payload?.error ||
                payload?.message ||
                `Search failed with HTTP ${response.status}.`
            );
        }

        const jobs = normaliseResponse(payload);

        currentResults = jobs;

        const sortedJobs = sortResults(currentResults);

        renderResults(sortedJobs);

        if (jobs.length === 0) {
            showStatus(
                "No jobs matched that search. Try changing the keywords, location or filters.",
                "info"
            );
        } else {
            clearStatus();
        }

    } catch (error) {
        if (error.name === "AbortError") {
            return;
        }

        console.error("Job search failed:", error);

        currentResults = [];
        renderResults([]);

        showStatus(
            error.message || "Something went wrong while searching for jobs.",
            "error"
        );

    } finally {
        setLoading(false);
        activeRequestController = null;
    }
}


// ============================================================
// 6. READ SEARCH FORM
// ============================================================

function getSearchValues() {
    const providers = providerInputs
        .filter(input => input.checked)
        .map(input => input.value.trim())
        .filter(Boolean);

    return {
        query: queryInput?.value.trim() || "",
        location: locationInput?.value.trim() || "",
        salaryMin: parsePositiveInteger(salaryInput?.value),
        postedWithin: parsePositiveInteger(postedWithinInput?.value),
        resultsPerSource: parsePositiveInteger(resultsPerSourceInput?.value),
        providers
    };
}


// ============================================================
// 7. VALIDATION
// ============================================================

function validateSearch(search) {
    if (!search.query) {
        showStatus(
            "Enter a job title, skill or keyword to search for.",
            "error"
        );

        queryInput?.focus();
        return false;
    }

    if (search.query.length > 150) {
        showStatus(
            "Search keywords must be 150 characters or fewer.",
            "error"
        );

        return false;
    }

    if (search.location.length > 150) {
        showStatus(
            "Location must be 150 characters or fewer.",
            "error"
        );

        return false;
    }

    if (search.salaryMin !== null) {
        if (search.salaryMin < 0 || search.salaryMin > 1000000) {
            showStatus(
                "Enter a valid minimum salary.",
                "error"
            );

            return false;
        }
    }

    if (search.providers.length === 0) {
        showStatus(
            "Select at least one job provider.",
            "error"
        );

        return false;
    }

    return true;
}


// ============================================================
// 8. BUILD API QUERY
// ============================================================

function buildSearchParams(search) {
    const params = new URLSearchParams();

    params.set("q", search.query);

    if (search.location) {
        params.set("location", search.location);
    }

    if (search.salaryMin !== null) {
        params.set("salaryMin", String(search.salaryMin));
    }

    if (search.postedWithin !== null) {
        params.set("postedWithin", String(search.postedWithin));
    }

    if (search.resultsPerSource !== null) {
        params.set(
            "resultsPerSource",
            String(search.resultsPerSource)
        );
    }

    if (search.providers.length > 0) {
        params.set(
            "providers",
            search.providers.join(",")
        );
    }

    return params;
}


// ============================================================
// 9. READ API RESPONSE SAFELY
// ============================================================

async function readJSONResponse(response) {
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.toLowerCase().includes("application/json")) {
        const text = await response.text();

        throw new Error(
            text
                ? `Unexpected API response: ${text.slice(0, 200)}`
                : "The API returned an invalid response."
        );
    }

    return response.json();
}


// ============================================================
// 10. NORMALISE WORKER RESPONSE
// ============================================================

function normaliseResponse(payload) {
    let jobs = [];

    if (Array.isArray(payload)) {
        jobs = payload;
    } else if (Array.isArray(payload?.jobs)) {
        jobs = payload.jobs;
    } else if (Array.isArray(payload?.results)) {
        jobs = payload.results;
    }

    return jobs
        .filter(job => job && typeof job === "object")
        .map(normaliseJob)
        .filter(job => job.title && job.url);
}


function normaliseJob(job) {
    return {
        id:
            safeString(job.id) ||
            createJobKey(job),

        title:
            safeString(job.title) ||
            "Untitled role",

        company:
            safeString(job.company) ||
            "Company not provided",

        location:
            safeString(job.location) ||
            "Location not provided",

        description:
            safeString(job.description),

        salaryMin:
            safeNumber(job.salaryMin),

        salaryMax:
            safeNumber(job.salaryMax),

        salary:
            safeString(job.salary),

        postedAt:
            safeString(
                job.postedAt ||
                job.date ||
                job.createdAt
            ),

        provider:
            safeString(
                job.provider ||
                job.source
            ) || "Job board",

        url:
            safeHTTPURL(
                job.url ||
                job.redirectUrl
            ),

        contractType:
            safeString(job.contractType),

        remote:
            Boolean(job.remote)
    };
}


// ============================================================
// 11. RENDER RESULTS
// ============================================================

function renderResults(jobs) {
    if (!resultsContainer) {
        return;
    }

    resultsContainer.replaceChildren();

    updateResultsCount(jobs.length);

    if (resultsSection) {
        resultsSection.hidden = false;
    }

    if (jobs.length === 0) {
        return;
    }

    const fragment = document.createDocumentFragment();

    for (const job of jobs) {
        fragment.appendChild(createJobCard(job));
    }

    resultsContainer.appendChild(fragment);
}


// ============================================================
// 12. CREATE JOB CARD
// ============================================================

function createJobCard(job) {
    const article = document.createElement("article");
    article.className = "job-card";

    // --------------------------------------------------------
    // Header
    // --------------------------------------------------------

    const header = document.createElement("div");
    header.className = "job-card__header";

    const titleArea = document.createElement("div");
    titleArea.className = "job-card__title-area";

    const title = document.createElement("h2");
    title.className = "job-card__title";
    title.textContent = job.title;

    const company = document.createElement("p");
    company.className = "job-card__company";
    company.textContent = job.company;

    titleArea.append(title, company);

    const provider = document.createElement("span");
    provider.className = "job-card__provider";
    provider.textContent = job.provider;

    header.append(titleArea, provider);

    // --------------------------------------------------------
    // Meta information
    // --------------------------------------------------------

    const meta = document.createElement("div");
    meta.className = "job-card__meta";

    addMetaItem(meta, "Location", job.location);

    const salary = formatSalary(job);

    if (salary) {
        addMetaItem(meta, "Salary", salary);
    }

    if (job.contractType) {
        addMetaItem(
            meta,
            "Contract",
            job.contractType
        );
    }

    if (job.remote) {
        addMetaItem(
            meta,
            "Work",
            "Remote"
        );
    }

    const posted = formatPostedDate(job.postedAt);

    if (posted) {
        addMetaItem(
            meta,
            "Posted",
            posted
        );
    }

    // --------------------------------------------------------
    // Description
    // --------------------------------------------------------

    let description = null;

    if (job.description) {
        description = document.createElement("p");
        description.className = "job-card__description";
        description.textContent = truncateText(
            stripHTML(job.description),
            300
        );
    }

    // --------------------------------------------------------
    // Footer
    // --------------------------------------------------------

    const footer = document.createElement("div");
    footer.className = "job-card__footer";

    const viewButton = document.createElement("a");

    viewButton.className = "button button--primary";
    viewButton.textContent = "View job";

    viewButton.href = job.url;
    viewButton.target = "_blank";

    viewButton.rel =
        "noopener noreferrer nofollow";

    footer.appendChild(viewButton);

    // --------------------------------------------------------
    // Assemble
    // --------------------------------------------------------

    article.appendChild(header);
    article.appendChild(meta);

    if (description) {
        article.appendChild(description);
    }

    article.appendChild(footer);

    return article;
}


// ============================================================
// 13. META ITEM
// ============================================================

function addMetaItem(container, label, value) {
    if (!value) {
        return;
    }

    const item = document.createElement("span");
    item.className = "job-card__meta-item";

    const labelElement = document.createElement("strong");
    labelElement.textContent = `${label}: `;

    const valueElement = document.createElement("span");
    valueElement.textContent = value;

    item.append(labelElement, valueElement);

    container.appendChild(item);
}


// ============================================================
// 14. RESULTS COUNT
// ============================================================

function updateResultsCount(count) {
    if (!resultsCount) {
        return;
    }

    if (count === 1) {
        resultsCount.textContent = "1 job found";
        return;
    }

    resultsCount.textContent =
        `${count.toLocaleString("en-GB")} jobs found`;
}


// ============================================================
// 15. SORTING
// ============================================================

function sortResults(jobs) {
    const jobsCopy = [...jobs];

    const sortBy = sortSelect?.value || "newest";

    switch (sortBy) {

        case "salary-high":
            return jobsCopy.sort((a, b) => {
                return getSalaryValue(b) - getSalaryValue(a);
            });

        case "salary-low":
            return jobsCopy.sort((a, b) => {
                const salaryA = getSalaryValue(a);
                const salaryB = getSalaryValue(b);

                if (!salaryA && !salaryB) {
                    return 0;
                }

                if (!salaryA) {
                    return 1;
                }

                if (!salaryB) {
                    return -1;
                }

                return salaryA - salaryB;
            });

        case "title":
            return jobsCopy.sort((a, b) => {
                return a.title.localeCompare(
                    b.title,
                    "en-GB",
                    {
                        sensitivity: "base"
                    }
                );
            });

        case "newest":
        default:
            return jobsCopy.sort((a, b) => {
                return getTimestamp(b.postedAt) -
                    getTimestamp(a.postedAt);
            });
    }
}


// ============================================================
// 16. SALARY HELPERS
// ============================================================

function formatSalary(job) {
    if (job.salary) {
        return job.salary;
    }

    const min = job.salaryMin;
    const max = job.salaryMax;

    if (min !== null && max !== null) {
        if (min === max) {
            return formatGBP(min);
        }

        return `${formatGBP(min)} – ${formatGBP(max)}`;
    }

    if (min !== null) {
        return `From ${formatGBP(min)}`;
    }

    if (max !== null) {
        return `Up to ${formatGBP(max)}`;
    }

    return "";
}


function formatGBP(value) {
    if (!Number.isFinite(value)) {
        return "";
    }

    return new Intl.NumberFormat(
        "en-GB",
        {
            style: "currency",
            currency: "GBP",
            maximumFractionDigits: 0
        }
    ).format(value);
}


function getSalaryValue(job) {
    if (Number.isFinite(job.salaryMax)) {
        return job.salaryMax;
    }

    if (Number.isFinite(job.salaryMin)) {
        return job.salaryMin;
    }

    return 0;
}


// ============================================================
// 17. DATE HELPERS
// ============================================================

function formatPostedDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const now = Date.now();
    const difference = now - date.getTime();

    if (difference < 0) {
        return date.toLocaleDateString("en-GB");
    }

    const minutes = Math.floor(
        difference / 60000
    );

    const hours = Math.floor(
        difference / 3600000
    );

    const days = Math.floor(
        difference / 86400000
    );

    if (minutes < 1) {
        return "Just now";
    }

    if (minutes < 60) {
        return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
    }

    if (hours < 24) {
        return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    }

    if (days < 7) {
        return `${days} day${days === 1 ? "" : "s"} ago`;
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


function getTimestamp(value) {
    if (!value) {
        return 0;
    }

    const timestamp = new Date(value).getTime();

    return Number.isNaN(timestamp)
        ? 0
        : timestamp;
}


// ============================================================
// 18. LOADING STATE
// ============================================================

function setLoading(isLoading) {
    if (!searchButton) {
        return;
    }

    searchButton.disabled = isLoading;

    if (isLoading) {
        searchButton.dataset.originalText =
            searchButton.textContent;

        searchButton.textContent = "Searching…";
    } else {
        searchButton.textContent =
            searchButton.dataset.originalText ||
            "Search jobs";
    }

    searchForm?.setAttribute(
        "aria-busy",
        String(isLoading)
    );
}


// ============================================================
// 19. STATUS MESSAGES
// ============================================================

function showStatus(message, type = "info") {
    if (!statusMessage) {
        console[type === "error" ? "error" : "log"](
            message
        );

        return;
    }

    statusMessage.hidden = false;
    statusMessage.textContent = message;

    statusMessage.className =
        `status-message status-message--${type}`;

    statusMessage.setAttribute(
        "role",
        type === "error" ? "alert" : "status"
    );
}


function clearStatus() {
    if (!statusMessage) {
        return;
    }

    statusMessage.hidden = true;
    statusMessage.textContent = "";
    statusMessage.className = "status-message";
}


// ============================================================
// 20. URL SEARCH STATE
// ============================================================

function updateBrowserURL(search) {
    const url = new URL(window.location.href);

    setOrDeleteURLParameter(
        url,
        "q",
        search.query
    );

    setOrDeleteURLParameter(
        url,
        "location",
        search.location
    );

    setOrDeleteURLParameter(
        url,
        "salaryMin",
        search.salaryMin
    );

    setOrDeleteURLParameter(
        url,
        "postedWithin",
        search.postedWithin
    );

    if (search.providers.length) {
        url.searchParams.set(
            "providers",
            search.providers.join(",")
        );
    } else {
        url.searchParams.delete("providers");
    }

    window.history.replaceState(
        {},
        "",
        url
    );
}


function restoreSearchFromURL() {
    const params = new URLSearchParams(
        window.location.search
    );

    const query = params.get("q");
    const location = params.get("location");
    const salaryMin = params.get("salaryMin");
    const postedWithin = params.get("postedWithin");
    const providers = params.get("providers");

    if (query && queryInput) {
        queryInput.value = query;
    }

    if (location && locationInput) {
        locationInput.value = location;
    }

    if (salaryMin && salaryInput) {
        salaryInput.value = salaryMin;
    }

    if (postedWithin && postedWithinInput) {
        postedWithinInput.value = postedWithin;
    }

    if (providers) {
        const enabledProviders = new Set(
            providers
                .split(",")
                .map(value => value.trim())
                .filter(Boolean)
        );

        providerInputs.forEach(input => {
            input.checked =
                enabledProviders.has(input.value);
        });
    }
}


function setOrDeleteURLParameter(
    url,
    key,
    value
) {
    if (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ""
    ) {
        url.searchParams.set(
            key,
            String(value)
        );
    } else {
        url.searchParams.delete(key);
    }
}


// ============================================================
// 21. SECURITY / SANITISATION HELPERS
// ============================================================

function safeHTTPURL(value) {
    if (!value) {
        return "";
    }

    try {
        const url = new URL(
            String(value)
        );

        if (
            url.protocol !== "https:" &&
            url.protocol !== "http:"
        ) {
            return "";
        }

        return url.href;

    } catch {
        return "";
    }
}


function stripHTML(value) {
    if (!value) {
        return "";
    }

    const parser = new DOMParser();

    const documentObject = parser.parseFromString(
        String(value),
        "text/html"
    );

    return (
        documentObject.body.textContent ||
        ""
    ).trim();
}


// ============================================================
// 22. GENERIC HELPERS
// ============================================================

function safeString(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value).trim();
}


function safeNumber(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}


function parsePositiveInteger(value) {
    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
    ) {
        return null;
    }

    const number = Number.parseInt(
        value,
        10
    );

    return Number.isFinite(number)
        ? number
        : null;
}


function truncateText(text, maximumLength) {
    if (!text) {
        return "";
    }

    if (text.length <= maximumLength) {
        return text;
    }

    return `${text.slice(
        0,
        maximumLength
    ).trim()}…`;
}


function createJobKey(job) {
    const raw = [
        safeString(job.title),
        safeString(job.company),
        safeString(job.location),
        safeString(job.provider || job.source)
    ]
        .join("|")
        .toLowerCase();

    let hash = 0;

    for (let index = 0; index < raw.length; index++) {
        hash =
            ((hash << 5) - hash) +
            raw.charCodeAt(index);

        hash |= 0;
    }

    return `job-${Math.abs(hash)}`;
}
