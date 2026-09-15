// Three.js r186 public APIs: upload textures and compile materials before the
// entrance. A nonblocking WebGL fence then waits for an actual submitted frame.
export async function prepareScene({
  gl,
  scene,
  camera,
  signal,
  nextFrame,
  onProgress = () => {},
}) {
  const textures = new Set();
  const add = (value) => {
    if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value);
  };
  scene.traverse((object) => {
    for (const material of [object.material].flat().filter(Boolean)) {
      Object.values(material).forEach(add);
      Object.values(material.uniforms || {}).forEach((uniform) =>
        add(uniform.value),
      );
    }
  });
  let count = 0;
  for (const texture of textures) {
    signal?.throwIfAborted();
    gl.initTexture(texture);
    onProgress(0.35 * (++count / textures.size));
    await nextFrame();
  }
  signal?.throwIfAborted();
  await gl.compileAsync(scene, camera);
  signal?.throwIfAborted();
  onProgress(0.7);
  // Scene callbacks run before the composer's render. Yield beyond the current
  // frame so the fence covers refraction, bloom and output as well as geometry.
  await nextFrame();
  await nextFrame();
  signal?.throwIfAborted();
  const context = gl.getContext();
  const fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) throw new Error("Unable to confirm the prepared GPU frame");
  try {
    context.flush();
    for (;;) {
      signal?.throwIfAborted();
      if (context.isContextLost())
        throw new Error("WebGL context lost during preparation");
      const status = context.clientWaitSync(fence, 0, 0);
      if (
        status === context.ALREADY_SIGNALED ||
        status === context.CONDITION_SATISFIED
      )
        break;
      if (status === context.WAIT_FAILED)
        throw new Error("GPU preparation failed");
      await nextFrame();
    }
  } finally {
    context.deleteSync(fence);
  }
  onProgress(1);
}
