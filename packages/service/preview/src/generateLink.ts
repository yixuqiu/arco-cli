import type { ComponentMap } from '@arco-cli/component';
import { toWindowsCompatiblePath } from '@arco-cli/legacy/dist/utils/path';

export function generateLink(
  prefix: string,
  componentMap: ComponentMap<string[]>,
  mainModule?: string,
  isSplitComponentBundle = false
): string {
  const links = componentMap.toArray().map(([component, modulePath], compIdx) => ({
    componentIdentifier: component.id,
    modules: modulePath.map((path, pathIdx) => ({
      varName: moduleVarName(compIdx, pathIdx),
      resolveFrom: toWindowsCompatiblePath(path),
    })),
  }));

  return `
import { linkModules } from '${toWindowsCompatiblePath(
    require.resolve('./preview/preview.preview.runtime')
  )}';
${
  mainModule
    ? `import * as mainModule from '${toWindowsCompatiblePath(mainModule)}';`
    : 'const mainModule = {};'
}

${links
  .map((link) =>
    link.modules
      .map((module) => `import * as ${module.varName} from "${module.resolveFrom}";`)
      .join('\n')
  )
  .filter((line) => line !== '') // prevent empty lines
  .join('\n')}

linkModules('${prefix}', {
  mainModule,
  isSplitComponentBundle: ${isSplitComponentBundle},
  componentMap: {
${links
  // must include all components, including empty
  .map(
    (link) =>
      `    "${link.componentIdentifier}": [${link.modules
        .map((module) => module.varName)
        .join(', ')}]`
  )
  .join(',\n')}
  }
});
`;
}

function moduleVarName(componentIdx: number, fileIdx: number) {
  return `file_${componentIdx}_${fileIdx}`;
}