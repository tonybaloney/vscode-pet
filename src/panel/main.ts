// This script will be run within the webview itself
import { PetSize, PetColor, PetType, Theme, ColorThemeKind, WebviewMessage } from '../common/types';
import { createPet, IPetType, InvalidPetException, PetCollection, PetElement, IPetCollection } from './pets';
import { BallState, ChaseFriendState, PetElementState, PetInstanceState, PetPanelState, States } from './states';

/* This is how the VS Code API can be invoked from the panel */
declare global {
  interface VscodeStateApi { 
    getState() : PetPanelState; // API is actually Any, but we want it to be typed.
    setState(state: PetPanelState): void;
    postMessage(message: WebviewMessage): void;
  }
  interface Window {
    acquireVsCodeApi(): VscodeStateApi;
  }
}

const vscode = window.acquireVsCodeApi();

var allPets: IPetCollection = new PetCollection();
var petCounter: number;

function calculateBallRadius(size: PetSize): number{
  if (size === PetSize.nano){
    return 2;
  } else if (size === PetSize.medium){
    return 4;
  } else if (size === PetSize.large){
    return 8;
  } else {
    return 1; // Shrug
  }
}

function calculateFloor(size: PetSize, theme: Theme): number {
  switch (theme){
    case Theme.forest:
      switch (size){
        case PetSize.medium:
          return 40;
        case PetSize.large:
          return 65;
        case PetSize.nano:
        default:
          return 23;
      }
    case Theme.castle:
      switch (size){
        case PetSize.medium:
          return 80;
        case PetSize.large:
          return 120;
        case PetSize.nano:
        default:
          return 45;
      }
  }
  return 0;
}

function handleMouseOver(e: MouseEvent){
  var el = e.currentTarget as HTMLDivElement;
  allPets.pets().forEach(element => {
    if (element.collision === el){
      if (!element.pet.canSwipe()) {
        return;
      }
      element.pet.swipe();
    }
  });
  
}

function startAnimations(collision: HTMLDivElement, pet: IPetType) {
  collision.addEventListener("mouseover", handleMouseOver);
  setInterval(() => {
    var updates = allPets.seekNewFriends();
    updates.forEach(message => {
      vscode.postMessage({
        text: message,
        command: 'info'
      });
    });
    pet.nextFrame();
    saveState();
  }, 100);
}

function addPetToPanel(petType: PetType, basePetUri: string, petColor: PetColor, petSize: PetSize, left: number, bottom: number, floor: number, name: string | undefined): PetElement {
  var petSpriteElement: HTMLImageElement = document.createElement("img");
  petSpriteElement.className = "pet";
  (document.getElementById("petsContainer") as HTMLDivElement).appendChild(petSpriteElement);

  var collisionElement: HTMLDivElement = document.createElement("div");
  collisionElement.className = "collision";
  (document.getElementById("petsContainer") as HTMLDivElement).appendChild(collisionElement);

  const root = basePetUri + '/' + petType + '/' + petColor;
  console.log("Creating new pet : ", petType, root);
  var newPet = createPet(petType, petSpriteElement, collisionElement, petSize, left, bottom, root, floor, name);
  petCounter ++ ;
  startAnimations(collisionElement, newPet);
  return new PetElement(petSpriteElement, collisionElement, newPet, petColor, petType);
}

function saveState(){
  var state = new PetPanelState();
  state.petStates = new Array();

  allPets.pets().forEach(petItem => {
    state.petStates!.push({
      petName: petItem.pet.name(),
      petColor: petItem.color,
      petType: petItem.type,
      petState: petItem.pet.getState(),
      petFriend: petItem.pet.friend() ? petItem.pet.friend().name() : undefined,
      elLeft: petItem.el.style.left,
      elBottom: petItem.el.style.bottom
    });
  });
  state.petCounter = petCounter;
  vscode.setState(state);
}

function recoverState(basePetUri: string, petSize: PetSize, floor: number){
  var state = vscode.getState();
  
  if (state.petCounter === undefined || isNaN(state.petCounter)){
    petCounter = 1;
  } else {
    petCounter = state.petCounter!;
  }

  var recoveryMap: Map<IPetType, PetElementState> = new Map();
  state.petStates!.forEach(p => {
    // Fixes a bug related to duck animations
    if (p.petType as string === "rubber duck") {(p.petType as string) = "rubber-duck";}

    try {
      var newPet = addPetToPanel(
        p.petType!, 
        basePetUri, 
        p.petColor!, 
        petSize, 
        parseInt(p.elLeft!), 
        parseInt(p.elBottom!), 
        floor,
        p.petName);
      allPets.push(newPet);
      recoveryMap.set(newPet.pet, p);
    } catch (InvalidPetException){
      console.log("State had invalid pet (" + p.petType + "), discarding.");
    }
  });
  recoveryMap.forEach( (state, pet) => {
    // Recover previous state.
    pet.recoverState(state.petState!);

    // Resolve friend relationships
    var friend = undefined;
    if (state.petFriend){
      friend = allPets.locate(state.petFriend);
      if (friend){
        pet.recoverFriend(friend.pet);
      }
    }
  });
}

function randomStartPosition() : number {
  return Math.floor(Math.random() * (window.innerWidth * 0.7));
}

let canvas : HTMLCanvasElement, ctx: CanvasRenderingContext2D;

function initCanvas() {
  canvas = (document.getElementById("petCanvas") as HTMLCanvasElement);
  ctx = (canvas.getContext("2d") as CanvasRenderingContext2D);
  ctx.canvas.width = window.innerWidth;
  ctx.canvas.height = window.innerHeight;
}

// It cannot access the main VS Code APIs directly.
export function petPanelApp(basePetUri: string, theme: Theme, themeKind: ColorThemeKind, petColor: PetColor, petSize: PetSize, petType: PetType) {
  const ballRadius: number = calculateBallRadius(petSize);
  var floor = 0;
  // Apply Theme backgrounds
  if (theme !== Theme.none){
    var _themeKind = "";
    switch (themeKind) {
      case ColorThemeKind.Dark:
        _themeKind = "dark";
        break;
      case ColorThemeKind.Light:
        _themeKind = "light";
        break;
      case ColorThemeKind.HighContrast:
      default:
        _themeKind = "light";
        break;
    }


    document.body.style.backgroundImage = `url('${basePetUri}/backgrounds/${theme}/background-${_themeKind}-${petSize}.png')`;
    document.getElementById("foreground")!.style.backgroundImage = `url('${basePetUri}/backgrounds/${theme}/foreground-${_themeKind}-${petSize}.png')`;
    
    floor = calculateFloor(petSize, theme); // Themes have pets at a specified height from the ground
  } else {
    document.body.style.backgroundImage = "";
    document.getElementById("foreground")!.style.backgroundImage = "";
  }

  /// Bouncing ball components, credit https://stackoverflow.com/a/29982343
  const gravity: number = 0.2, damping: number = 0.9, traction: number = 0.8;
  var ballState: BallState;

  function resetBall() {
    canvas.style.display = "block";
    ballState = new BallState(100, 100, 2, 5);
  }

  function throwBall() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!ballState.paused) {requestAnimationFrame(throwBall);}

    if (ballState.cx + ballRadius >= canvas.width) {
      ballState.vx = -ballState.vx * damping;
      ballState.cx = canvas.width - ballRadius;
    } else if (ballState.cx - ballRadius <= 0) {
      ballState.vx = -ballState.vx * damping;
      ballState.cx = ballRadius;
    }
    if (ballState.cy + ballRadius + floor >= (canvas.height)) {
      ballState.vy = -ballState.vy * damping;
      ballState.cy = canvas.height - ballRadius - floor;
      // traction here
      ballState.vx *= traction;
    } else if (ballState.cy - ballRadius <= 0) {
      ballState.vy = -ballState.vy * damping;
      ballState.cy = ballRadius;
    }

    ballState.vy += gravity;

    ballState.cx += ballState.vx;
    ballState.cy += ballState.vy;

    ctx.beginPath();
    ctx.arc(ballState.cx, ballState.cy, ballRadius, 0, 2 * Math.PI, false);
    ctx.fillStyle = "#2ed851";
    ctx.fill();
  }

  console.log('Starting pet session', petColor, basePetUri, petType);
  // New session
  var state = vscode.getState();
  if (!state) {
    console.log('No state, starting a new session.');
    petCounter = 1;
    allPets.push(addPetToPanel(petType, basePetUri, petColor, petSize, randomStartPosition(), floor, floor, undefined));
    saveState();
  } else { 
    console.log('Recovering state - ', state);
    recoverState(basePetUri, petSize, floor);
  }

  initCanvas();

  // Handle messages sent from the extension to the webview
  window.addEventListener("message", (event) => {
    const message = event.data; // The json data that the extension sent
    switch (message.command) {
      case "throw-ball":
        resetBall();
        throwBall();
        allPets.pets().forEach(petEl => {
          if (petEl.pet.canChase()){
            petEl.pet.chase(ballState, canvas);
          }
        });
        break;
      case "spawn-pet":
        allPets.push(addPetToPanel(message.type, basePetUri, message.color, petSize, randomStartPosition(), floor, floor, undefined));
        saveState();
        break;
      case "reset-pet":
        allPets.pets().forEach(pet => {
          pet.el.remove();
          pet.collision.remove();
        });
        allPets.reset();
        allPets.push(addPetToPanel(message.type, basePetUri, message.color, message.size, randomStartPosition(), floor, floor, undefined));
        petCounter = 1;
        saveState();
        break;
    }
  });

};
window.addEventListener('resize', function () {
  initCanvas();
});
