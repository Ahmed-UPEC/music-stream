// js/lazy-images.js
//
// True viewport-gated image loading. Native loading="lazy" still prefetches
// images 1000-6000px below the fold (browser dependent), so card grids loaded
// the artwork for the entire page at once. Cover <img> tags are rendered with
// a data-src attribute (see ui.js getCoverHTML) and only get their real src
// when they come within 200px of the viewport.

export const LAZY_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export function initLazyImages() {
    if (!('IntersectionObserver' in window)) {
        // Very old browser: load everything immediately
        const loadAll = (root) => {
            for (const img of root.querySelectorAll?.('img[data-src]') || []) {
                img.src = img.dataset.src;
                delete img.dataset.src;
            }
        };
        loadAll(document.body);
        new MutationObserver(() => loadAll(document.body)).observe(document.body, {
            childList: true,
            subtree: true,
        });
        return;
    }

    const io = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    delete img.dataset.src;
                }
                io.unobserve(img);
            }
        },
        { rootMargin: '200px' }
    );

    const watch = (node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.matches?.('img[data-src]')) io.observe(node);
        for (const img of node.querySelectorAll?.('img[data-src]') || []) {
            io.observe(img);
        }
    };

    watch(document.body);
    new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const added of mutation.addedNodes) watch(added);
        }
    }).observe(document.body, { childList: true, subtree: true });
}
