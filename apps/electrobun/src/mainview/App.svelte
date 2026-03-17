<script lang="ts">
  import { onMount } from "svelte";

  import Loader from "@/components/Loader.svelte";
  import MapRenderer from "@/components/MapRenderer.svelte";

  let windowHeight = 0;
  let windowWidth = 0;
  let loading = true;
  let fadeOut = false;
  let loadingPercent = 0;
  let loadingLabel = "Initializing...";

  function handleResize() {
    windowWidth = window.innerWidth;
    windowHeight = window.innerHeight;
  }

  function handleProgress(percent: number, label: string) {
    loadingPercent = percent;
    loadingLabel = label;
  }

  function handleReady() {
    fadeOut = true;
    setTimeout(() => {
      loading = false;
    }, 400);
  }

  onMount(() => {
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  });
</script>

<main>
  {#if loading}
    <div class="loader-overlay" class:fade-out={fadeOut}>
      <Loader percent={loadingPercent} label={loadingLabel} />
    </div>
  {/if}
  <div class="content" class:hidden={!fadeOut && loading}>
    <MapRenderer onReady={handleReady} onProgress={handleProgress} />
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
  }

  main {
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(135deg, #1e1e1e 0%, #2a2a2a 100%);
    position: relative;
  }

  .loader-overlay {
    position: absolute;
    inset: 0;
    z-index: 9999;
    opacity: 1;
    transition: opacity 0.4s ease;
  }

  .loader-overlay.fade-out {
    opacity: 0;
    pointer-events: none;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow: hidden;
  }

  .content.hidden {
    visibility: hidden;
  }
</style>
