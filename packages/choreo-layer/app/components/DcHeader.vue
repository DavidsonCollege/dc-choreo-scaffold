<!--
  The Davidson header every Choreo app shares: a skip link for keyboard and
  screen reader users, then the app's name linking home. Styled with the brand
  tokens as CSS variables, so it doesn't depend on Tailwind scanning the layer.
-->
<script setup lang="ts">
const { title } = useRuntimeConfig().public.choreo as { title: string }
</script>

<template>
  <a class="dc-skip" href="#main">Skip to main content</a>
  <header class="dc-header">
    <NuxtLink to="/" class="dc-header__title">
      {{ title }}
    </NuxtLink>
  </header>
</template>

<style scoped>
.dc-skip {
  position: absolute;
  left: -9999px;
  top: 0;
  padding: 0.5rem 1rem;
  background: var(--color-dc-paper);
  color: var(--color-dc-ink);
}

.dc-skip:focus {
  left: 0.5rem;
}

.dc-header {
  background: var(--color-dc-accent);
  color: var(--color-dc-on-accent);
  padding: 1rem;
}

.dc-header__title {
  color: var(--color-dc-on-accent);
  font-size: 1.25rem;
  font-weight: 600;
  text-decoration: none;
}

.dc-header__title:focus-visible {
  outline: 2px solid var(--color-dc-on-accent);
  outline-offset: 2px;
}
</style>
