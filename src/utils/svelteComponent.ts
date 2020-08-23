import path from 'path';
import getUniqueId from './getUniqueId';
import IntersectionObserver from './IntersectionObserver';
import { HydrateOptions } from './types';

export const getComponentName = (str) => {
  let out = str.replace('.svelte', '').replace('.js', '');
  if (out.includes('/')) {
    out = out.split('/').pop();
  }
  return out;
};

export const replaceSpecialCharacters = (str) =>
  str
    .replace(/&quot;/gim, '"')
    .replace(/&lt;/gim, '<')
    .replace(/&gt;/gim, '>')
    .replace(/&#39;/gim, "'")
    .replace(/\\\\n/gim, '')
    .replace(/\\"/gim, '"')
    .replace(/&amp;/gim, '&');

// TODO: can we possibly add a cache for components so we aren't requiring multiple times?

interface ComponentPayload {
  page: any;
  props: any;
  hydrateOptions?: HydrateOptions;
}

const svelteComponent = (componentName) => ({ page, props, hydrateOptions }: ComponentPayload): string => {
  const cleanComponentName = getComponentName(componentName);

  const id = getUniqueId();

  const clientComponents = page.settings.$$internal.hashedComponents;

  const ssrComponent = path.resolve(
    process.cwd(),
    `./${page.settings.locations.svelte.ssrComponents}${cleanComponentName}.js`,
  );

  let clientSvelteFolder = page.settings.locations.svelte.clientComponents.replace(page.settings.locations.public, '/');
  if (clientSvelteFolder.indexOf('.') === 0) clientSvelteFolder = clientSvelteFolder.substring(1);
  const clientComponent = `${clientSvelteFolder}${clientComponents[cleanComponentName]}.js`;

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { render } = require(ssrComponent);

  try {
    const { css, html: htmlOutput, head } = render({ ...props, link: page.helpers.permalinks });

    if (css && css.code && css.code.length > 0 && page.cssStack) {
      page.cssStack.push({ source: componentName, priority: 50, string: css.code });
    }

    if (head && page.headStack) {
      page.headStack.push({ source: componentName, priority: 50, string: head });
    }

    let finalHtmlOuput = htmlOutput;
    const matches = finalHtmlOuput.matchAll(
      /<div class="needs-hydration" data-component="([A-Za-z]+)" data-hydrate="({.*})" data-options="({.*})"><\/div>/gim,
    );

    for (const match of matches) {
      const hydrateComponentName = match[1];

      const dataHydrate = JSON.parse(replaceSpecialCharacters(match[2]));
      const dataOptions = JSON.parse(replaceSpecialCharacters(match[3]));
      console.log(dataHydrate, dataOptions);

      if (hydrateOptions) {
        throw new Error(
          `Client side hydrated component includes client side hydrated sub component. This isn't supported.`,
        );
      }

      const hydratedHtml = svelteComponent(hydrateComponentName)({
        page,
        props: dataHydrate,
        hydrateOptions: dataOptions,
      });
      finalHtmlOuput = finalHtmlOuput.replace(match[0], hydratedHtml);
    }

    if (!hydrateOptions) {
      // if a component isn't hydrated we don't need to wrap it in a unique div.
      return finalHtmlOuput;
    }

    // hydrate a component

    /**
     * hydrate-options={{ lazy: false }} This would cause the component to be hydrate in a blocking manner.
     * hydrate-options={{ preload: true }} This adds a preload to the head stack as outlined above... could be preloaded without forcing blocking.
     * hydrate-options={{ preload: true, lazy: false }} This would preload and be blocking.
     * hydrate-options={{ rootMargin: '500' }} This would adjust the root margin of the intersection observer. Only usable with lazy: true.
     * hydrate-options={{ inline: true }}  components are display block by default. If this is true, this adds <div style="display:inline;"> to the wrapper.
     */

    // should we use the IntersectionObserver and / or adjust the distance?

    if (hydrateOptions.preload) {
      page.headStack.push({
        source: componentName,
        priority: 50,
        string: `<link rel="preload" href="${clientComponent}" as="script">`,
      });
    }

    const clientJs = `
    System.import('${clientComponent}').then(({ default: App }) => {
    new App({ target: document.getElementById('${cleanComponentName.toLowerCase()}-${id}'), hydrate: true, props: ${JSON.stringify(
      props,
    )} });
    });`;

    // should we not lazy load it?
    if (hydrateOptions.lazy) {
      page.hydrateStack.push({
        source: componentName,
        priority: 50,
        string: `
        function init${cleanComponentName.toLowerCase()}${id}() {
          ${clientJs}
        }
        ${IntersectionObserver({
          el: `document.getElementById('${cleanComponentName.toLowerCase()}-${id}')`,
          name: `${cleanComponentName.toLowerCase()}`,
          loaded: `init${cleanComponentName.toLowerCase()}${id}();`,
          notLoaded: `init${cleanComponentName.toLowerCase()}${id}();`,
          rootMargin: hydrateOptions.rootMargin || 200,
          id,
        })}
      `,
      });
    } else {
      // this is eager loaded. Still requires System.js to be defined.
      page.hydrateStack.push({
        source: componentName,
        priority: 50,
        string: clientJs,
      });
    }

    if (hydrateOptions.inline) {
      return `<div class="${cleanComponentName.toLowerCase()}" id="${cleanComponentName.toLowerCase()}-${id}" style="display:inline;">${finalHtmlOuput}</div>`;
    }
    return `<div class="${cleanComponentName.toLowerCase()}" id="${cleanComponentName.toLowerCase()}-${id}">${finalHtmlOuput}</div>`;
  } catch (e) {
    console.log(e);
    page.errors.push(e);
  }
  return '';
};

export default svelteComponent;
