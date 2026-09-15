// Adapter for the published Home controller's horizontal angular response:
// delta.lerp(Mouse.down ? Mouse.delta : zero, .07), rotation += delta.x * .0025,
// then logo.rotation.y includes 2 * rotation. The mobile gain is .0075 * 2.
// Source capture: outputs/verification/v0.22/reference-home-controller.txt.
// The source holds Mouse.delta between events; this adapter consumes each
// displacement once. Its 0.22 response is tuned for that pipeline and the
// requested shorter lag, rather than treating the source's 0.07 as universal.
// A fixed 60 Hz step keeps travel consistent across browser frame rates.
export const createTurnInput = () => ({
  pending: 0,
  velocity: 0,
  remainder: 0,
});
export function resetTurnInput(input) {
  if (input) input.pending = input.velocity = input.remainder = 0;
}
export function advanceReferenceTurn(model, delta) {
  const input = model.turnInput;
  if (!input) return;
  if (model.paused || model.reduced || model.progress.get() >= 0.01) {
    resetTurnInput(input);
    return;
  }
  if (input.pending === 0 && input.velocity === 0) return;
  input.remainder += Math.min(Math.max(delta, 0), 0.05) * 60;
  const steps = Math.floor(input.remainder + 1e-8);
  if (!steps) return;
  input.remainder -= steps;
  const movement = input.pending / steps;
  input.pending = 0;
  let angle = model.yaw.get();
  for (let step = 0; step < steps; step++) {
    input.velocity += (movement - input.velocity) * 0.22;
    angle += input.velocity;
  }
  if (Math.abs(input.velocity) < 1e-7) input.velocity = 0;
  model.yaw.set(angle);
}
