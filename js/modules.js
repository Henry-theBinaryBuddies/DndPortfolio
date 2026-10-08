/* =========================================================
   ARTIFACT MODULE CONTENT SYSTEM
   ========================================================= */

const moduleCards =
  document.querySelectorAll(".module-card");

const moduleOverlay =
  document.getElementById("module-overlay");

const moduleCloseButton =
  document.getElementById("module-detail-close");

const moduleDetailTitle =
  document.getElementById("module-detail-title");

const moduleDetailSubtitle =
  moduleOverlay.querySelector(
    ".module-detail__header .module-detail__subtitle"
  );

const moduleDetailImage =
  moduleOverlay.querySelector(
    ".module-detail__image"
  );


/* =========================================================
   LOCATE CONTENT SECTIONS
   ========================================================= */

const aboutSection =
  findModuleSection(
    "About the Artifact"
  );

const reflectionSection =
  findModuleSection(
    "Reflection"
  );


/* =========================================================
   STATE
   ========================================================= */

let lastModuleTrigger = null;

let activeContentRequest = 0;


/* =========================================================
   REGISTER MODULE CARDS
   ========================================================= */

moduleCards.forEach((card) => {

  const cover =
    card.querySelector(
      ".module-card__cover"
    );


  if (!cover) {
    return;
  }


  cover.addEventListener(
    "click",
    (event) => {

      event.preventDefault();

      openModuleOverlay(
        card,
        cover
      );

    }
  );

});


/* =========================================================
   CLOSE BUTTON
   ========================================================= */

moduleCloseButton.addEventListener(
  "click",
  () => {

    closeModuleOverlay();

  }
);


/* =========================================================
   CLICK OUTSIDE BOOK
   ========================================================= */

moduleOverlay.addEventListener(
  "click",
  (event) => {

    if (
      event.target ===
      moduleOverlay
    ) {

      closeModuleOverlay();

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
      !moduleOverlay.hidden
    ) {

      closeModuleOverlay();

    }

  }
);


/* =========================================================
   OPEN MODULE
   ========================================================= */

async function openModuleOverlay(
  card,
  trigger
) {

  lastModuleTrigger =
    trigger;


  const requestId =
    ++activeContentRequest;


  const artifactId =
    card.id;


  if (!artifactId) {

    console.error(
      "Artifact card is missing an id."
    );

    return;

  }


  updateModuleHeader(
    card
  );


  updateModuleImage(
    card
  );


  setSectionMessage(
    aboutSection,
    "Loading artifact information..."
  );


  setSectionMessage(
    reflectionSection,
    "Loading reflection..."
  );


  moduleOverlay.hidden =
    false;


  moduleCloseButton.focus();


  const basePath =
    `./content/artifacts/${artifactId}`;


  const [
    aboutResult,
    reflectionResult
  ] =
    await Promise.all([
      loadTextFile(
        `${basePath}/About.txt`
      ),

      loadTextFile(
        `${basePath}/Reflection.txt`
      )
    ]);


  /*
    Ignore an old request if the user opened
    another artifact before this fetch completed.
  */
  if (
    requestId !==
    activeContentRequest
  ) {

    return;

  }


  if (aboutResult.ok) {

    renderSectionText(
      aboutSection,
      aboutResult.text
    );

  }
  else {

    setSectionMessage(
      aboutSection,
      "About content is not available yet."
    );

  }


  if (reflectionResult.ok) {

    renderSectionText(
      reflectionSection,
      reflectionResult.text
    );

  }
  else {

    setSectionMessage(
      reflectionSection,
      "Reflection content is not available yet."
    );

  }

}


/* =========================================================
   CLOSE MODULE
   ========================================================= */

function closeModuleOverlay() {

  moduleOverlay.hidden =
    true;


  /*
    Invalidates any pending fetch belonging
    to the module that was just closed.
  */
  activeContentRequest++;


  if (lastModuleTrigger) {

    lastModuleTrigger.focus();

  }

}


/* =========================================================
   UPDATE OVERLAY HEADER
   ========================================================= */

function updateModuleHeader(
  card
) {

  const title =
    card.querySelector(
      ".module-card__title"
    );


  const subtitle =
    card.querySelector(
      ".module-card__subtitle"
    );


  moduleDetailTitle.textContent =
    title
      ? title.textContent.trim()
      : "Artifact";


  moduleDetailSubtitle.textContent =
    subtitle
      ? subtitle.textContent.trim()
      : "";

}


/* =========================================================
   UPDATE OVERLAY IMAGE
   ========================================================= */

function updateModuleImage(
  card
) {

  const sourceImage =
    card.querySelector(
      ".module-card__art img"
    );


  moduleDetailImage.replaceChildren();


  if (!sourceImage) {
    return;
  }


  const image =
    document.createElement("img");


  image.src =
    sourceImage.src;


  image.alt =
    sourceImage.alt || "";


  /*
    Kept inline so this wiring does not require
    another CSS change.
  */
  image.style.display =
    "block";

  image.style.width =
    "100%";

  image.style.height =
    "100%";

  image.style.objectFit =
    "cover";


  moduleDetailImage.appendChild(
    image
  );

}


/* =========================================================
   FIND SECTION BY HEADING
   ========================================================= */

function findModuleSection(
  headingText
) {

  const sections =
    moduleOverlay.querySelectorAll(
      ".module-detail__section"
    );


  return Array.from(
    sections
  ).find((section) => {

    const heading =
      section.querySelector("h3");


    return (
      heading &&
      heading.textContent.trim() ===
      headingText
    );

  });

}


/* =========================================================
   LOAD TEXT FILE
   ========================================================= */

async function loadTextFile(
  path
) {

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


    const text =
      await response.text();


    return {
      ok: true,
      text: text.trim()
    };

  }
  catch (error) {

    console.error(
      `Unable to load ${path}`,
      error
    );


    return {
      ok: false,
      text: ""
    };

  }

}


/* =========================================================
   RENDER TEXT FILE INTO SECTION
   ========================================================= */

function renderSectionText(
  section,
  text
) {

  if (!section) {
    return;
  }


  removeSectionBody(
    section
  );


  const normalizedText =
    text.trim();


  if (!normalizedText) {

    setSectionMessage(
      section,
      "No content has been added yet."
    );

    return;

  }


  /*
    A blank line separates paragraphs.

    This means the .txt files can remain completely
    normal prose documents.
  */
  const paragraphs =
    normalizedText
      .replace(
        /\r\n/g,
        "\n"
      )
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


      section.appendChild(
        paragraph
      );

    }
  );

}


/* =========================================================
   SECTION STATUS MESSAGE
   ========================================================= */

function setSectionMessage(
  section,
  message
) {

  if (!section) {
    return;
  }


  removeSectionBody(
    section
  );


  const paragraph =
    document.createElement("p");


  paragraph.textContent =
    message;


  section.appendChild(
    paragraph
  );

}


/* =========================================================
   REMOVE OLD SECTION CONTENT

   Preserve the H3 and replace everything underneath it.
   ========================================================= */

function removeSectionBody(
  section
) {

  Array.from(
    section.children
  ).forEach((child) => {

    if (
      child.tagName !== "H3"
    ) {

      child.remove();

    }

  });

}
