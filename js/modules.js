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
   PHOTO GALLERY
   ========================================================= */

const moduleGallery =
  document.getElementById("module-gallery");

const moduleGalleryImage =
  document.getElementById("module-gallery-image");

const moduleGalleryCaption =
  document.getElementById("module-gallery-caption");

const moduleGalleryCounter =
  document.getElementById("module-gallery-counter");

const moduleGalleryPrevious =
  document.getElementById("module-gallery-previous");

const moduleGalleryNext =
  document.getElementById("module-gallery-next");

let galleryPhotos = [];

let galleryIndex = 0;


/*
  These handlers are attached once, here, and not each
  time an artifact opens. Attaching them on every open
  would stack them, and one click would then move
  several photos.
*/
moduleGalleryPrevious.addEventListener(
  "click",
  () => showGalleryPhoto(galleryIndex - 1)
);

moduleGalleryNext.addEventListener(
  "click",
  () => showGalleryPhoto(galleryIndex + 1)
);

document.addEventListener(
  "keydown",
  (event) => {

    if (
      moduleOverlay.hidden ||
      moduleGallery.hidden ||
      galleryPhotos.length < 2
    ) {
      return;
    }

    if (event.key === "ArrowLeft") {

      event.preventDefault();

      showGalleryPhoto(galleryIndex - 1);

    }
    else if (event.key === "ArrowRight") {

      event.preventDefault();

      showGalleryPhoto(galleryIndex + 1);

    }

  }
);


/* A swipe left or right moves one photo on a touch screen. */
let galleryTouchStartX = null;

let galleryTouchStartY = null;

moduleGallery.addEventListener(
  "touchstart",
  (event) => {

    galleryTouchStartX =
      event.changedTouches[0].clientX;

    galleryTouchStartY =
      event.changedTouches[0].clientY;

  },
  { passive: true }
);

moduleGallery.addEventListener(
  "touchend",
  (event) => {

    if (galleryTouchStartX === null) {
      return;
    }

    const moveX =
      event.changedTouches[0].clientX -
      galleryTouchStartX;

    const moveY =
      event.changedTouches[0].clientY -
      galleryTouchStartY;

    galleryTouchStartX = null;

    if (
      Math.abs(moveX) > 50 &&
      Math.abs(moveX) > Math.abs(moveY) * 1.5
    ) {

      showGalleryPhoto(
        galleryIndex + (moveX < 0 ? 1 : -1)
      );

    }

  },
  { passive: true }
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

  updateModuleLinks(card);
  updateModuleText(card);

  /*
    The panel is shared, so a gallery from the artifact
    that was open before must never stay on screen.
  */
  setGallery([]);


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


  /*
    Only a card marked data-gallery has a Gallery.json,
    so other artifacts never ask for a file that is not there.
  */
  const galleryRequest =
    card.hasAttribute("data-gallery")
      ? loadTextFile(`${basePath}/Gallery.json`)
      : null;


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


  if (galleryRequest) {

    const galleryResult =
      await galleryRequest;


    if (
      requestId !==
      activeContentRequest
    ) {

      return;

    }


    if (galleryResult.ok) {

      setGallery(
        parseGallery(
          galleryResult.text
        )
      );

    }

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


  setGallery([]);


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
   UPDATE TOOLS TEXT
   ========================================================= */
function updateModuleText(card) {
  const toolText = moduleOverlay.querySelector("#tools_text");

  const text = card.dataset.tools;

  if (text) {
    toolText.textContent = text;
  } else {
    toolText.textContent = "TBD";
  }

}

/* =========================================================
   UPDATE MODULE LINKS
   ========================================================= */
function updateModuleLinks (card) {
  const artifactLink =
    moduleOverlay.querySelector(
      "#artifact_link"
    );

  const artifactNote = card.dataset.viewUrl;

  if (artifactNote) {
    artifactLink.href = artifactNote;
    artifactLink.target = "_blank";
    artifactLink.rel = "noopener noreferrer";
  } else {
    artifactLink.href = "#";
    artifactLink.target = "";
    artifactLink.rel = "";
  }

  const repoLink =
    moduleOverlay.querySelector(
      "#repo_link"
    );

  const repoNote = card.dataset.repoUrl;


  if (repoNote) {
    repoLink.href = repoNote;
    repoLink.target = "_blank";
    repoLink.rel = "noopener noreferrer";
  } else {
    repoLink.href = "#";
    repoLink.target = "";
    repoLink.rel = "";
  }

  const docNote = card.dataset.documentUrl;


  const docLink =
    moduleOverlay.querySelector(
      "#documentation_link"
    );

  if (docNote) {
    docLink.href = docNote;
    docLink.target = "_blank";
    docLink.rel = "noopener noreferrer";
  } else {
    docLink.href = "#";
    docLink.target = "";
    docLink.rel = "";
  }

}


/* =========================================================
   PHOTO GALLERY FUNCTIONS
   ========================================================= */

/*
  Turns the text of Gallery.json into a clean list.
  Anything that is not a photo on this same site is
  ignored, so a typo in the file cannot break the panel.
*/
function parseGallery(
  text
) {

  let list;

  try {

    list = JSON.parse(text);

  }
  catch (error) {

    console.error(
      "Gallery.json is not valid JSON",
      error
    );

    return [];

  }


  if (!Array.isArray(list)) {

    return [];

  }


  return list
    .filter((item) =>
      item &&
      typeof item.src === "string" &&
      item.src.trim() !== "" &&
      new URL(
        item.src,
        document.baseURI
      ).origin === location.origin
    )
    .map((item) => ({
      src: item.src.trim(),
      alt:
        typeof item.alt === "string"
          ? item.alt
          : "",
      caption:
        typeof item.caption === "string"
          ? item.caption
          : ""
    }));

}


/* Show one photo, wrapping round at either end. */
function showGalleryPhoto(
  index
) {

  if (galleryPhotos.length === 0) {
    return;
  }


  galleryIndex =
    (index + galleryPhotos.length) %
    galleryPhotos.length;


  const photo =
    galleryPhotos[galleryIndex];


  moduleGalleryImage.src =
    photo.src;

  moduleGalleryImage.alt =
    photo.alt;

  moduleGalleryCaption.textContent =
    photo.caption;

  moduleGalleryCounter.textContent =
    `${galleryIndex + 1} / ${galleryPhotos.length}`;


  /* Start loading the next photo so it is ready. */
  new Image().src =
    galleryPhotos[
      (galleryIndex + 1) %
      galleryPhotos.length
    ].src;

}


/*
  Put a list of photos on screen, or (with an empty
  list) take the gallery away and bring back the
  single cover picture.
*/
function setGallery(
  photos
) {

  galleryPhotos =
    photos;

  galleryIndex =
    0;


  const hasGallery =
    photos.length > 0;

  const hasSeveral =
    photos.length > 1;


  moduleGallery.hidden =
    !hasGallery;

  moduleDetailImage.hidden =
    hasGallery;

  moduleGalleryPrevious.hidden =
    !hasSeveral;

  moduleGalleryNext.hidden =
    !hasSeveral;

  moduleGalleryCounter.hidden =
    !hasSeveral;


  if (hasGallery) {

    showGalleryPhoto(0);

  }
  else {

    moduleGalleryImage.removeAttribute("src");

    moduleGalleryImage.alt =
      "";

    moduleGalleryCaption.textContent =
      "";

    moduleGalleryCounter.textContent =
      "";

  }

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
