"use strict";

/*
 * Job Hunter
 * frontend/app.js
 *
 * Matches the existing index.html and Cloudflare Worker API.
 */

const $ = selector => document.querySelector(selector);

const jobsEl = $("#jobs");
const statusEl = $("#status");
const errorEl = $("#error");
const searchForm = $("#searchForm");
const searchButton = $("#searchBtn");
const sortSelect = $("#sort");

let current = [];


// ============================================================
// SAFE OUTPUT HELPERS
// ============================================================

const esc = value =>
    String(value ?? "").replace(
        /[&<>"']/g,
        character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]
    );


const money = value => {

    const number = Number(value);

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
};


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


// ============================================================
// DATE DISPLAY
// ============================================================

function formatDate(value) {

    if (!value) {
        return "Date not listed";
    }

    const date = new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return value;
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
// SALARY DISPLAY
// ============================================================

function formatSalary(job) {

    const minimum =
        money(job.salaryMin);

    const maximum =
        money(job.salaryMax);

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
// RENDER RESULTS
// ============================================================

function render() {

    const sort =
        sortSelect.value;

    const list =
        [...current];

    if (
        sort === "salary"
    ) {

        list.sort(
            (a, b) =>
                (
                    Number(b.salaryMax) ||
                    Number(b.salaryMin) ||
                    0
                ) -
                (
                    Number(a.salaryMax) ||
                    Number(a.salaryMin) ||
                    0
                )
        );

    } else if (
        sort === "title"
    ) {

        list.sort(
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

    } else {

        list.sort(
            (a, b) => {

                const dateA =
                    new Date(
                        a.postedAt || 0
                    ).getTime();

                const dateB =
                    new Date(
                        b.postedAt || 0
                    ).getTime();

                return (
                    (
                        Number.isNaN(dateB)
                            ? 0
                            : dateB
                    ) -
                    (
                        Number.isNaN(dateA)
                            ? 0
                            : dateA
                    )
                );
            }
        );
    }


    if (
        list.length === 0
    ) {

        jobsEl.innerHTML = `
            <div class="empty">
                No jobs matched this search.
            </div>
        `;

        return;
    }


    jobsEl.innerHTML =
        list.map(job => {

            const salary =
                formatSalary(job);

            const date =
                formatDate(
                    job.postedAt
                );

            /*
             * IMPORTANT:
             * Worker returns "provider",
             * not "source".
             */

            const provider =
                job.provider ||
                job.source ||
                "Job board";

            const description =
                String(
                    job.description || ""
                );

            const shortDescription =
                description.length > 320
                    ? `${description.slice(0, 320)}…`
                    : description;

            const url =
                safeUrl(
                    job.url
                );

            return `
                <article class="job">

                    <div class="jobTop">

                        <div>

                            <h3>
                                ${esc(
                                    job.title ||
                                    "Untitled job"
                                )}
                            </h3>

                            <p class="company">
                                ${esc(
                                    job.company ||
                                    "Company not listed"
                                )}
                            </p>

                        </div>

                        <a
                            href="${esc(url)}"
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                        >
                            View job →
                        </a>

                    </div>

                    <div class="meta">

                        <span class="pill">
                            ${esc(
                                job.location ||
                                "Location not listed"
                            )}
                        </span>

                        <span class="pill">
                            ${esc(salary)}
                        </span>

                        <span class="pill">
                            ${esc(date)}
                        </span>

                        <span class="pill source">
                            ${esc(provider)}
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
                                        ${esc(
                                            job.contractType
                                        )}
                                    </span>
                                `
                                : ""
                        }

                    </div>

                    ${
                        shortDescription
                            ? `
                                <p class="desc">
                                    ${esc(
                                        shortDescription
                                    )}
                                </p>
                            `
                            : ""
                    }

                </article>
            `;

        }).join("");
}


// ============================================================
// SORT
// ============================================================

sortSelect.addEventListener(
    "change",
    render
);


// ============================================================
// SEARCH
// ============================================================

searchForm.addEventListener(
    "submit",
    async event => {

        event.preventDefault();

        errorEl.hidden = true;
        errorEl.textContent = "";


        // ----------------------------------------------------
        // SEARCH QUERY
        // ----------------------------------------------------

        const query =
            $("#q").value.trim();

        if (!query) {

            errorEl.textContent =
                "Enter a job title, skill or keyword.";

            errorEl.hidden = false;

            return;
        }


        // ----------------------------------------------------
        // PROVIDERS
        // ----------------------------------------------------

        const providers =
            [
                ...document.querySelectorAll(
                    'input[name="source"]:checked'
                )
            ]
                .map(
                    input => input.value
                )
                /*
                 * Existing HTML currently uses
                 * cvlib while Worker expects
                 * cvlibrary.
                 */
                .map(
                    provider =>
                        provider === "cvlib"
                            ? "cvlibrary"
                            : provider
                );


        if (
            providers.length === 0
        ) {

            errorEl.textContent =
                "Select at least one source.";

            errorEl.hidden = false;

            return;
        }


        // ----------------------------------------------------
        // BUILD QUERY
        // ----------------------------------------------------

        const params =
            new URLSearchParams();

        params.set(
            "q",
            query
        );

        /*
         * FIX:
         *
         * Worker expects:
         * providers=
         *
         * NOT:
         * sources=
         */

        params.set(
            "providers",
            providers.join(",")
        );


        /*
         * FIX:
         *
         * Worker expects:
         * resultsPerSource=
         *
         * NOT:
         * limit=
         */

        params.set(
            "resultsPerSource",
            $("#limit").value
        );


        const location =
            $("#location").value.trim();

        const salary =
            $("#salaryMin").value.trim();

        const days =
            $("#days").value.trim();


        if (location) {

            params.set(
                "location",
                location
            );
        }


        if (salary) {

            params.set(
                "salaryMin",
                salary
            );
        }


        /*
         * FIX:
         *
         * Worker expects:
         * postedWithin=
         *
         * NOT:
         * days=
         */

        if (days) {

            params.set(
                "postedWithin",
                days
            );
        }


        // ----------------------------------------------------
        // API BASE
        // ----------------------------------------------------

        const base =
            (
                window
                    .JOB_HUNTER_CONFIG
                    ?.API_BASE ||
                ""
            )
                .trim()
                .replace(
                    /\/+$/,
                    ""
                );


        if (
            !base ||
            base.includes(
                "YOUR-WORKER"
            )
        ) {

            errorEl.textContent =
                "Set API_BASE in config.js to your deployed Worker URL.";

            errorEl.hidden = false;

            return;
        }


        // ----------------------------------------------------
        // LOADING
        // ----------------------------------------------------

        searchButton.disabled = true;

        searchButton.textContent =
            "Searching…";

        statusEl.textContent =
            "Searching configured job boards…";

        jobsEl.innerHTML = "";


        try {

            /*
             * CRITICAL FIX:
             *
             * Worker route is:
             *
             * /api/jobs/search
             *
             * Original frontend incorrectly used:
             *
             * /api/search
             */

            const requestUrl =
                `${base}/api/jobs/search?${params.toString()}`;


            console.log(
                "Job Hunter request:",
                requestUrl
            );


            const response =
                await fetch(
                    requestUrl,
                    {
                        method: "GET",

                        headers: {
                            Accept:
                                "application/json"
                        }
                    }
                );


            const data =
                await response.json();


            console.log(
                "Job Hunter response:",
                data
            );


            if (
                !response.ok
            ) {

                throw new Error(
                    data.error ||
                    `Search failed (${response.status})`
                );
            }


            // ------------------------------------------------
            // RESULTS
            // ------------------------------------------------

            current =
                Array.isArray(
                    data.jobs
                )
                    ? data.jobs
                    : [];


            const providerNames =
                data.providers &&
                typeof data.providers ===
                    "object"
                    ? Object.entries(
                        data.providers
                    )
                        .filter(
                            ([, info]) =>
                                info?.ok
                        )
                        .map(
                            ([name]) =>
                                name === "cvlibrary"
                                    ? "CV-Library"
                                    : name
                                        .charAt(0)
                                        .toUpperCase() +
                                      name.slice(1)
                        )
                    : [];


            statusEl.textContent =
                `${current.length} unique job${
                    current.length === 1
                        ? ""
                        : "s"
                } found${
                    providerNames.length
                        ? ` via ${providerNames.join(", ")}`
                        : ""
                }.`;


            render();


            // ------------------------------------------------
            // PROVIDER WARNINGS
            // ------------------------------------------------

            const failedProviders =
                data.providers &&
                typeof data.providers ===
                    "object"
                    ? Object.entries(
                        data.providers
                    ).filter(
                        ([, info]) =>
                            info?.ok === false
                    )
                    : [];


            if (
                failedProviders.length
            ) {

                console.warn(
                    "Some job providers failed:",
                    failedProviders
                );
            }


        } catch (error) {

            console.error(
                "Job Hunter search failed:",
                error
            );


            current = [];

            jobsEl.innerHTML = "";


            errorEl.textContent =
                error.message ||
                "Search failed.";

            errorEl.hidden = false;

            statusEl.textContent =
                "Search failed.";


        } finally {

            searchButton.disabled = false;

            searchButton.textContent =
                "Search jobs";
        }
    }
);
