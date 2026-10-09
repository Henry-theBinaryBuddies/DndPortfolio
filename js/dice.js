import DiceBox from
    "https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/dice-box.es.min.js";


/* =========================================================
   DOM REFERENCES
   ========================================================= */

const diceButtons =
  document.querySelectorAll(".die");

const diceTray =
  document.getElementById("dice-tray");

const diceBoxElement =
  document.getElementById("dice-box");

const diceResultOverlay =
  document.getElementById("dice-result-overlay");

const diceResultDismiss =
  document.getElementById("dice-result-dismiss");

const diceResultType =
  document.getElementById("dice-result-type");

const diceResultNumber =
  document.getElementById("dice-result-number");

const diceRollSound =
  new Audio("./assets/audio/diceroll.mp3");

diceRollSound.volume = 0.7;


/* =========================================================
   STATE
   ========================================================= */

let diceBox = null;

let diceBoxReady = false;

let isRolling = false;

let lastRolledDie = null;


/* =========================================================
   INITIALIZE DICEBOX
   ========================================================= */

async function initializeDiceBox() {

  setDiceDisabled(true);


  diceBox = new DiceBox({

    container:
      "#dice-box",

    assetPath:
      "assets/",

    origin:
      "https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/",

    theme:
      "default",

    themeColor:
      "#742f25",

    scale:
      5.5,

    gravity:
      1.15,

    mass:
      1,

    friction:
      0.72,

    restitution:
      0.28,

    angularDamping:
      0.32,

    linearDamping:
      0.34,

    spinForce:
      7,

    throwForce:
      6.5,

    startingHeight:
      9,

    lightIntensity:
      1.25,

    enableShadows:
      true,

    shadowTransparency:
      0.68,

    settleTimeout:
      6000

  });


  try {

    await diceBox.init();

    diceBoxReady = true;

    setDiceDisabled(false);

  }
  catch (error) {

    console.error(
      "The 3D dice engine could not be initialized.",
      error
    );

    diceBoxReady = false;

    setDiceDisabled(false);

  }

}


/* =========================================================
   REGISTER DIE BUTTONS
   ========================================================= */

diceButtons.forEach((die) => {

  die.addEventListener(
    "click",
    async () => {

      if (isRolling) {
        return;
      }


      const sides =
        Number(
          die.dataset.sides
        );


      if (
        !Number.isInteger(sides) ||
        sides < 2
      ) {
        return;
      }

      /*
        Restart the sound from the beginning
        for each new roll.
      */
      diceRollSound.currentTime = 0;

      diceRollSound
        .play()
        .catch((error) => {

          console.warn(
            "Dice sound could not play.",
            error
          );

        });


      await rollDie(
        die,
        sides
      );

    }
  );

});


/* =========================================================
   ROLL DIE
   ========================================================= */

async function rollDie(
  die,
  sides
) {

  isRolling = true;

  lastRolledDie = die;

  setDiceDisabled(true);


  diceTray.classList.add(
    "is-rolling"
  );


  diceResultOverlay.hidden =
    true;


  if (
    diceBoxReady &&
    diceBox
  ) {

    try {

      showDiceBox();


      const results =
        await diceBox.roll(
          `1d${sides}`
        );


      const value =
        extractDiceValue(
          results,
          sides
        );


      await wait(
        350
      );


      showDiceResult(
        sides,
        value
      );

    }
    catch (error) {

      console.error(
        `Unable to roll d${sides}.`,
        error
      );


      const value =
        generateFallbackRoll(
          sides
        );


      hideDiceBox();


      showDiceResult(
        sides,
        value
      );

    }

  }
  else {

    const value =
      generateFallbackRoll(
        sides
      );


    await wait(
      300
    );


    showDiceResult(
      sides,
      value
    );

  }


  diceTray.classList.remove(
    "is-rolling"
  );


  setDiceDisabled(false);


  isRolling = false;

}


/* =========================================================
   EXTRACT RESULT
   ========================================================= */

function extractDiceValue(
  results,
  sides
) {

  const group =
    Array.isArray(results)
      ? results[0]
      : results;


  const firstRoll =
    group?.rolls?.[0];


  const value =
    firstRoll?.value ??
    firstRoll?.result ??
    group?.value;


  if (
    Number.isInteger(value) &&
    value >= 1 &&
    value <= sides
  ) {
    return value;
  }


  return generateFallbackRoll(
    sides
  );

}


/* =========================================================
   SHOW RESULT
   ========================================================= */

function showDiceResult(
  sides,
  value
) {

  diceResultType.textContent =
    `d${sides}`;


  diceResultNumber.textContent =
    value;


  diceResultOverlay.hidden =
    false;


  diceResultDismiss.focus();

}


/* =========================================================
   DISMISS RESULT
   ========================================================= */

diceResultDismiss.addEventListener(
  "click",
  () => {

    closeDiceResult();

  }
);


diceResultOverlay.addEventListener(
  "click",
  (event) => {

    if (
      event.target ===
      diceResultOverlay
    ) {

      closeDiceResult();

    }

  }
);


document.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key === "Escape" &&
      !diceResultOverlay.hidden
    ) {

      closeDiceResult();

    }

  }
);


function closeDiceResult() {

  diceResultOverlay.hidden =
    true;


  if (
    diceBoxReady &&
    diceBox
  ) {

    diceBox.clear();

  }


  hideDiceBox();


  if (lastRolledDie) {

    lastRolledDie.focus();

  }

}


/* =========================================================
   DICEBOX VISIBILITY
   ========================================================= */

function showDiceBox() {

  diceBoxElement.classList.add(
    "is-active"
  );

}


function hideDiceBox() {

  diceBoxElement.classList.remove(
    "is-active"
  );

}


/* =========================================================
   ENABLE / DISABLE CONTROLS
   ========================================================= */

function setDiceDisabled(
  disabled
) {

  diceButtons.forEach(
    (die) => {

      die.disabled =
        disabled;

    }
  );

}


/* =========================================================
   FALLBACK RNG
   ========================================================= */

function generateFallbackRoll(
  sides
) {

  if (
    window.crypto &&
    window.crypto.getRandomValues
  ) {

    const range =
      0x100000000;


    const limit =
      Math.floor(
        range / sides
      ) * sides;


    const buffer =
      new Uint32Array(1);


    let value;


    do {

      window.crypto.getRandomValues(
        buffer
      );


      value =
        buffer[0];

    }
    while (
      value >= limit
      );


    return (
      value % sides
    ) + 1;

  }


  return (
    Math.floor(
      Math.random() *
      sides
    ) + 1
  );

}


/* =========================================================
   DELAY
   ========================================================= */

function wait(
  milliseconds
) {

  return new Promise(
    (resolve) => {

      window.setTimeout(
        resolve,
        milliseconds
      );

    }
  );

}


/* =========================================================
   START
   ========================================================= */

initializeDiceBox();
