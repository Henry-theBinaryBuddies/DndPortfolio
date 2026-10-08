/* =========================================================
   DEVELOPMENT LOG CONTENT SYSTEM
   ========================================================= */

const logBookButton =
  document.getElementById("log-book");

const logBookOverlay =
  document.getElementById(
    "logbook-overlay"
  );

const logBookCloseButton =
  document.getElementById(
    "logbook-close"
  );

const logBookEntries =
  logBookOverlay.querySelector(
    ".logbook-entries"
  );

const logBookEntryContent =
  logBookOverlay.querySelector(
    ".logbook-entry-content"
  );

const logBookEntryDate =
  logBookEntryContent.querySelector(
    "time"
  );

const logBookEntryTitle =
  logBookEntryContent.querySelector(
    "h3"
  );


/* =========================================================
   CONFIGURATION
   ========================================================= */

const logBookBasePath =
  "./content/dev-log";

const logBookIndexPath =
  `${logBookBasePath}/index.json`;


/* =========================================================
   STATE
   ========================================================= */

let logBookInitialized =
  false;

let activeEntryRequest =
  0;


/* =========================================================
   OPEN LOGBOOK
   ========================================================= */

logBookButton.addEventListener(
  "click",
  async () => {

    openLogBook();

    if (!logBookInitialized) {

      await initializeLogBook();

    }

  }
);


/* =========================================================
   CLOSE LOGBOOK
   ========================================================= */

logBookCloseButton.addEventListener(
  "click",
  () => {

    closeLogBook();

  }
);


/* =========================================================
   CLICK OUTSIDE BOOK
   ========================================================= */

logBookOverlay.addEventListener(
  "click",
  (event) => {

    if (
      event.target ===
      logBookOverlay
    ) {

      closeLogBook();

    }

  }
);


/* =========================================================
   ESCAPE KEY
   ========================================================= */

document.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "Escape" &&
      !logBookOverlay.hidden
    ) {

      closeLogBook();

    }

  }
);


/* =========================================================
   OPEN
   ========================================================= */

function openLogBook() {

  logBookOverlay.hidden =
    false;


  logBookCloseButton.focus();

}


/* =========================================================
   CLOSE
   ========================================================= */

function closeLogBook() {

  logBookOverlay.hidden =
    true;


  activeEntryRequest++;


  logBookButton.focus();

}


/* =========================================================
   INITIALIZE JOURNAL
   ========================================================= */

async function initializeLogBook() {

  renderEntryNavigationStatus(
    "Loading journal..."
  );


  setJournalContent(
    "",
    "Development Journal",
    "Loading journal..."
  );


  try {

    const response =
      await fetch(
        logBookIndexPath,
        {
          cache:
            "no-store"
        }
      );


    if (!response.ok) {

      throw new Error(
        `${response.status} ${response.statusText}`
      );

    }


    const manifest =
      await response.json();


    if (
      !Array.isArray(
        manifest.entries
      )
    ) {

      throw new Error(
        "index.json must contain an entries array."
      );

    }


    const entries =
      normalizeEntries(
        manifest.entries
      );


    if (
      entries.length === 0
    ) {

      renderEntryNavigationStatus(
        "No journal entries yet."
      );


      setJournalContent(
        "",
        "Development Journal",
        "No journal entries have been added yet."
      );


      logBookInitialized =
        true;


      return;

    }


    buildEntryNavigation(
      entries
    );


    logBookInitialized =
      true;


    /*
      Entries are sorted newest first.
    */
    await loadJournalEntry(
      entries[0]
    );

  }
  catch (error) {

    console.error(
      "Unable to initialize development log.",
      error
    );


    renderEntryNavigationStatus(
      "Unable to load journal."
    );


    setJournalContent(
      "",
      "Development Journal",
      "The development log could not be loaded."
    );

  }

}


/* =========================================================
   NORMALIZE MANIFEST ENTRIES
   ========================================================= */

function normalizeEntries(
  entries
) {

  return [
    ...new Set(
      entries
        .filter(
          (entry) =>
            typeof entry ===
            "string"
        )
        .map(
          (entry) =>
            entry.trim()
        )
        .filter(
          isIsoDate
        )
    )
  ].sort(
    (a, b) =>
      b.localeCompare(a)
  );

}


/* =========================================================
   BUILD DATE BUTTONS
   ========================================================= */

function buildEntryNavigation(
  entries
) {

  logBookEntries.replaceChildren();


  entries.forEach(
    (date) => {

      const button =
        document.createElement(
          "button"
        );


      button.type =
        "button";


      button.className =
        "logbook-entry";


      button.dataset.date =
        date;


      button.textContent =
        formatDateWithoutYear(
          date
        );


      button.setAttribute(
        "aria-label",
        `Open journal entry for ${formatDateWithYear(date)}`
      );


      button.addEventListener(
        "click",
        () => {

          loadJournalEntry(
            date
          );

        }
      );


      logBookEntries.appendChild(
        button
      );

    }
  );

}


/* =========================================================
   LOAD JOURNAL ENTRY
   ========================================================= */

async function loadJournalEntry(
  date
) {

  const requestId =
    ++activeEntryRequest;


  markActiveEntry(
    date
  );


  setJournalContent(
    date,
    "Development Journal",
    "Loading entry..."
  );


  const path =
    `${logBookBasePath}/${date}/Entry.txt`;


  try {

    const response =
      await fetch(
        path,
        {
          cache:
            "no-store"
        }
      );


    if (!response.ok) {

      throw new Error(
        `${response.status} ${response.statusText}`
      );

    }


    const rawText =
      await response.text();


    if (
      requestId !==
      activeEntryRequest
    ) {

      return;

    }


    const entry =
      parseJournalEntry(
        rawText
      );


    setJournalContent(
      date,
      entry.title,
      entry.body
    );

  }
  catch (error) {

    console.error(
      `Unable to load journal entry ${date}.`,
      error
    );


    if (
      requestId !==
      activeEntryRequest
    ) {

      return;

    }


    setJournalContent(
      date,
      "Development Journal",
      "This journal entry could not be loaded."
    );

  }

}


/* =========================================================
   JOURNAL FILE FORMAT

   Optional:
   The first line may begin with "# " and becomes
   the journal title.

   Example:

   # Portfolio Architecture

   Today I worked on...
   ========================================================= */

function parseJournalEntry(
  rawText
) {

  const normalizedText =
    rawText
      .replace(
        /\r\n/g,
        "\n"
      )
      .trim();


  if (!normalizedText) {

    return {
      title:
        "Development Journal",

      body:
        "No content has been added to this entry yet."
    };

  }


  const lines =
    normalizedText.split(
      "\n"
    );


  let title =
    "Development Journal";


  if (
    lines[0]
      .trim()
      .startsWith("# ")
  ) {

    title =
      lines
        .shift()
        .trim()
        .substring(2)
        .trim();

  }


  return {
    title,
    body:
      lines
        .join("\n")
        .trim()
  };

}


/* =========================================================
   RENDER JOURNAL CONTENT
   ========================================================= */

function setJournalContent(
  date,
  title,
  body
) {

  if (date) {

    logBookEntryDate.dateTime =
      date;


    logBookEntryDate.textContent =
      formatDateWithYear(
        date
      );

  }
  else {

    logBookEntryDate.removeAttribute(
      "datetime"
    );


    logBookEntryDate.textContent =
      "";

  }


  logBookEntryTitle.textContent =
    title;


  /*
    Remove previous paragraph content while
    preserving the time and H3.
  */
  Array.from(
    logBookEntryContent.children
  ).forEach((child) => {

    if (
      child.tagName !== "TIME" &&
      child.tagName !== "H3"
    ) {

      child.remove();

    }

  });


  renderJournalParagraphs(
    body
  );

}


/* =========================================================
   RENDER JOURNAL PARAGRAPHS
   ========================================================= */

function renderJournalParagraphs(
  text
) {

  const normalizedText =
    text.trim();


  if (!normalizedText) {

    const paragraph =
      document.createElement("p");


    paragraph.textContent =
      "No content has been added yet.";


    logBookEntryContent.appendChild(
      paragraph
    );


    return;

  }


  const paragraphs =
    normalizedText
      .split(
        /\n\s*\n/
      );


  paragraphs.forEach(
    (paragraphText) => {

      const paragraph =
        document.createElement("p");


      paragraph.textContent =
        paragraphText
          .trim()
          .replace(
            /\n/g,
            " "
          );


      logBookEntryContent.appendChild(
        paragraph
      );

    }
  );

}


/* =========================================================
   ACTIVE ENTRY
   ========================================================= */

function markActiveEntry(
  date
) {

  const buttons =
    logBookEntries.querySelectorAll(
      ".logbook-entry"
    );


  buttons.forEach(
    (button) => {

      const isActive =
        button.dataset.date ===
        date;


      if (isActive) {

        button.setAttribute(
          "aria-current",
          "true"
        );

      }
      else {

        button.removeAttribute(
          "aria-current"
        );

      }

    }
  );

}


/* =========================================================
   NAVIGATION STATUS
   ========================================================= */

function renderEntryNavigationStatus(
  message
) {

  logBookEntries.replaceChildren();


  const paragraph =
    document.createElement("p");


  paragraph.textContent =
    message;


  logBookEntries.appendChild(
    paragraph
  );

}


/* =========================================================
   DATE VALIDATION
   ========================================================= */

function isIsoDate(
  value
) {

  return (
    /^\d{4}-\d{2}-\d{2}$/
      .test(value)
  );

}


/* =========================================================
   DATE PARSING
   ========================================================= */

function createLocalDate(
  isoDate
) {

  const [
    year,
    month,
    day
  ] =
    isoDate
      .split("-")
      .map(Number);


  return new Date(
    year,
    month - 1,
    day
  );

}


/* =========================================================
   DISPLAY DATE — JOURNAL NAV
   ========================================================= */

function formatDateWithoutYear(
  isoDate
) {

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month:
        "long",

      day:
        "numeric"
    }
  ).format(
    createLocalDate(
      isoDate
    )
  );

}


/* =========================================================
   DISPLAY DATE — ENTRY PAGE
   ========================================================= */

function formatDateWithYear(
  isoDate
) {

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month:
        "long",

      day:
        "numeric",

      year:
        "numeric"
    }
  ).format(
    createLocalDate(
      isoDate
    )
  );

}
