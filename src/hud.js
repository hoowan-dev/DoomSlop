// The HUD is plain DOM on top of the canvas — cheaper and easier to style than
// anything drawn in the scene.

export class Hud {
  constructor() {
    this.healthEl = document.getElementById('health');
    this.scoreEl = document.getElementById('score');
    this.overlayEl = document.getElementById('overlay');

    this._health = null;
    this._score = null;
  }

  update(health, score) {
    // Only touch the DOM when a value actually changed.
    if (health !== this._health) {
      this.healthEl.textContent = `HP ${health}`;
      this._health = health;
    }
    if (score !== this._score) {
      this.scoreEl.textContent = `SCORE ${score}`;
      this._score = score;
    }
  }

  showOverlay(title, subtitle) {
    this.overlayEl.querySelector('h1').textContent = title;
    this.overlayEl.querySelector('p').textContent = subtitle;
    this.overlayEl.classList.remove('hidden');
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
  }
}
