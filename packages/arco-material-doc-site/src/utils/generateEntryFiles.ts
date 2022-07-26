import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import ora from 'ora';
import glob from 'glob';
import globParent from 'glob-parent';
import locale from '../locale';
import getMainConfig from './getMainConfig';
import { DocumentInfo, GlobConfigForBuild } from '../interface';
import { PLACEHOLDER_ARCO_SITE_MODULE_INFO } from '../constant';
import getTitleOfMarkdown from './getTitleOfMarkdown';
import getSubmodulePath, { SubmodulePathInfo } from './getSubmodulePath';

type ExportModuleInfo = {
  name: string;
  statement: string;
};

export const ENTRY_DIR_NAME = '.temp';
export const LIBRARY_MODULE_NAME = 'arcoSite';
const VARIABLE_PREFIX = LIBRARY_MODULE_NAME;

const FUNCTION_LABEL = '#FUNC#';
const FILE_CONTENT_PREFIX = [
  `/* Do NOT edit this file manually, it's generated by arco-material-doc-site. */`,
  `/* eslint-disable */`,
];

const { build: buildConfig, site: siteConfig, group: groupInfo } = getMainConfig();
const entryFileDir = path.resolve(ENTRY_DIR_NAME);

/**
 * Get specific file path by language as webpack build entry
 */
export function getPathEntryByLanguage(language: string) {
  return path.resolve(entryFileDir, `index.js`.replace(/.js$/, `.${language}.js`));
}

function transformObjectToExpression(obj: Object | Array<any>): string {
  return (
    JSON.stringify(obj || {}, null, 2)
      .replace(/^"(.*)"$/s, (_, $1) => $1)
      // Convert "#FUNC#() => true;#FUNC#" to () => true;
      .replace(new RegExp(`"?${FUNCTION_LABEL}"?`, 'g'), '')
  );
}

function generateDocTree(options: {
  entry: string;
  baseDir: string;
  filter?: (filePath: string) => boolean;
  onFile?: (filePath: string, info: DocumentInfo) => void;
}) {
  const { entry, baseDir, filter, onFile } = options;
  const result: Array<DocumentInfo> = [];
  const files = fs.readdirSync(entry);

  for (const file of files) {
    const filePath = path.resolve(entry, file);
    const filePathToBaseDir = `/${path.relative(baseDir, filePath)}`;
    const stats = fs.lstatSync(filePath);
    const isFile = stats.isFile();
    const isDirectory = stats.isDirectory();

    if (isFile) {
      if (!filter || filter(filePath)) {
        const info = {
          name: getTitleOfMarkdown(filePath),
          path: filePathToBaseDir,
        };
        result.push(info);
        onFile(filePath, info);
      }
    }

    if (isDirectory) {
      result.push({
        name: file,
        path: filePathToBaseDir,
        children: generateDocTree({
          ...options,
          entry: filePath,
        }),
      });
    }
  }

  const relativePath = path.relative(baseDir, entry) || '/';
  const sortRule = siteConfig?.menu?.sortRule?.[relativePath];
  if (Array.isArray(sortRule)) {
    return result.sort(({ name: nameA }, { name: nameB }) => {
      const indexA = sortRule.indexOf(nameA);
      const indexB = sortRule.indexOf(nameB);
      if (indexA > -1 && indexB > -1) {
        return indexA > indexB ? 1 : -1;
      }
      return indexB > -1 ? 1 : -1;
    });
  }

  return result;
}

async function extendSiteConfigFromRemoteGroupSetting() {
  // Try to get arcoDesignLabTheme from remote group settings
  if (groupInfo?.id && !siteConfig.arcoDesignLabTheme) {
    try {
      const spinner = ora();
      spinner.start(locale.TIP_USE_THEME_FROM_REMOTE_GROUP_CONFIG_ING);

      const {
        data: { result: hostInfo },
      } = await axios.get('https://arco.design/material/api/getHostInfo');
      const {
        data: {
          result: [{ theme, name: groupName }],
        },
      } = await axios.post(
        `${hostInfo[groupInfo.private ? 'private' : 'public'].arco}/material/api/group/`,
        {
          id: groupInfo.id,
        }
      );

      if (theme) {
        spinner.succeed(locale.TIP_USE_THEME_FROM_REMOTE_GROUP_CONFIG_DONE(groupName, theme));
        siteConfig.arcoDesignLabTheme = theme;
      } else {
        spinner.succeed(locale.TIP_USE_THEME_FROM_REMOTE_GROUP_CONFIG_FAIL);
      }
    } catch (e) {}
  }
}

/**
 * Generate submodule of entry file
 */
function generateSubmodules(
  submodulePathInfo: SubmodulePathInfo,
  language: string
): DocumentInfo[] {
  let documentInfo = [];

  Object.entries(submodulePathInfo).forEach(
    ([key, { glob: globConfig, path: submoduleEntryRelativePath }]) => {
      submoduleEntryRelativePath =
        typeof submoduleEntryRelativePath === 'object'
          ? submoduleEntryRelativePath[language]
          : submoduleEntryRelativePath;

      const exportModuleInfoList: ExportModuleInfo[] = [];
      const fileContent: string[] = [...FILE_CONTENT_PREFIX];
      const submoduleEntryPath = path.resolve(entryFileDir, submoduleEntryRelativePath);

      const getRelativePathForImport = (absolutePath: string): string => {
        return path
          .relative(path.dirname(submoduleEntryPath), absolutePath)
          .replace(/^[^.]/, (str) => `./${str}`);
      };

      switch (key as keyof GlobConfigForBuild) {
        case 'doc': {
          // Glob info about pure document
          const globDocBasePath = globParent(globConfig as string);
          const globDocMagicPath = (globConfig as string).replace(`${globDocBasePath}/`, '');
          const docEntryPathWithLanguage = path.resolve(globDocBasePath, language);
          const docEntryPath = fs.existsSync(docEntryPathWithLanguage)
            ? docEntryPathWithLanguage
            : globDocBasePath;
          const validDocPathList = glob.sync(path.resolve(docEntryPath, globDocMagicPath));

          documentInfo = generateDocTree({
            entry: docEntryPath,
            baseDir: docEntryPath,
            filter: (filePath) => validDocPathList.indexOf(filePath) > -1,
            onFile: (filePath, info) => {
              const componentName = `Doc${validDocPathList.indexOf(filePath)}`;
              const statement = `_${componentName}`;

              // import document
              fileContent.push(`\n// Import document from ${filePath}`);
              fileContent.push(
                `import * as ${statement} from '${getRelativePathForImport(filePath)}';\n`
              );

              // export document
              exportModuleInfoList.push({
                name: componentName,
                statement,
              });

              // write component name of document to docInfo
              info.moduleName = componentName;
            },
          });
          break;
        }

        case 'hook': {
          Object.entries(globConfig as GlobConfigForBuild['hook']).forEach(
            ([hookName, hookPattern]) => {
              const [hookPath] = glob.sync(hookPattern);
              if (hookPath) {
                fileContent.push(
                  `export { default as ${hookName} } from '${getRelativePathForImport(hookPath)}';`
                );
              }
            }
          );
          break;
        }

        case 'component': {
          glob
            .sync((globConfig as GlobConfigForBuild['component']).base)
            .map((p) => {
              const { demo, doc, style } = globConfig as GlobConfigForBuild['component'];
              return {
                componentName: path
                  .basename(p)
                  .replace(/(?:-|^)(\w)/g, (_, $1) => $1.toUpperCase())
                  .replace(/[^a-z1-9]/gi, ''),
                pathDemo: demo && path.resolve(p, demo),
                pathDoc: doc && path.resolve(p, doc),
                pathStyle: style && path.resolve(p, style),
              };
            })
            .forEach(({ componentName: moduleName, pathDemo, pathDoc, pathStyle }) => {
              let demoModuleName;
              let docModuleName;
              const tempFileContent = [`// Import demos and document of ${moduleName}`];

              if (fs.existsSync(pathDemo)) {
                demoModuleName = `_${moduleName}`;
                tempFileContent.push(
                  `import * as ${demoModuleName} from '${getRelativePathForImport(pathDemo)}';`
                );
              }

              if (fs.existsSync(pathDoc)) {
                docModuleName = `_${moduleName}Doc`;
                tempFileContent.push(
                  `import ${docModuleName} from '${getRelativePathForImport(pathDoc)}';`
                );
              }

              if (buildConfig.withMaterialStyle && fs.existsSync(pathStyle)) {
                tempFileContent.push(`import '${pathStyle}';`);
              }

              if (demoModuleName || docModuleName) {
                fileContent.push(`\n${tempFileContent.join('\n')}\n`);
                exportModuleInfoList.push({
                  name: moduleName,
                  statement: `{ ${demoModuleName ? `...${demoModuleName}, ` : ''}${
                    docModuleName ? `_SITE_DOC: ${docModuleName} ` : ''
                  }}`,
                });
              }
            });
          break;
        }

        default:
      }

      const exportExpressions = exportModuleInfoList
        .map(({ name, statement }) => {
          return `export const ${name} = ${statement};\n`;
        })
        .join('\n');

      fileContent.push(`\n// Export Modules\n${exportExpressions}`);

      fs.ensureDirSync(path.dirname(submoduleEntryPath));
      fs.writeFileSync(submoduleEntryPath, fileContent.join('\n'));
    }
  );

  return documentInfo;
}

/**
 * Generate entry file for webpack build
 */
function generateEntries(
  submodulePathInfoMap: Record<string, SubmodulePathInfo>,
  documentTreeMap: Record<string, DocumentInfo[]>,
  language: string
) {
  // Final content of entry file
  const fileContent = [...FILE_CONTENT_PREFIX];
  // Export statements
  const exportModuleInfoList: Array<{
    name: string;
    statement: string;
  }> = [];

  Object.entries(submodulePathInfoMap).forEach(([key, submoduleInfo]) => {
    const statement = {};

    Object.entries(submoduleInfo).forEach(([innerKey, { path: submoduleEntryRelativePath }]) => {
      submoduleEntryRelativePath =
        typeof submoduleEntryRelativePath === 'object'
          ? submoduleEntryRelativePath[language]
          : submoduleEntryRelativePath;

      if (fs.existsSync(path.resolve(entryFileDir, submoduleEntryRelativePath))) {
        const importName = `${key}_${innerKey}`;
        fileContent.push(`import * as ${importName} from '${submoduleEntryRelativePath}';`);
        statement[innerKey] = importName;
      }
    });

    exportModuleInfoList.push({
      name: key,
      statement: `{ ${Object.entries(statement)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')} }`,
    });
  });

  if (buildConfig.customModulePath && fs.existsSync(buildConfig.customModulePath)) {
    const exportName = `${VARIABLE_PREFIX}CustomModule`;
    fileContent.push(
      `import * as _${exportName} from '${path.relative(
        entryFileDir,
        path.resolve(buildConfig.customModulePath)
      )}';`
    );
    exportModuleInfoList.push({
      name: exportName,
      statement: `_${exportName}`,
    });
  }

  exportModuleInfoList.push({
    name: `${VARIABLE_PREFIX}ModuleInfo`,
    statement: 'decodeInfo(moduleInfoStr)',
  });

  exportModuleInfoList.push({
    name: `${VARIABLE_PREFIX}Config`,
    statement: transformObjectToExpression(siteConfig),
  });

  if (groupInfo) {
    exportModuleInfoList.push({
      name: `${VARIABLE_PREFIX}GroupInfo`,
      statement: transformObjectToExpression(groupInfo),
    });
  }

  exportModuleInfoList.push({
    name: `${VARIABLE_PREFIX}DocumentInfo`,
    statement: transformObjectToExpression(documentTreeMap),
  });

  exportModuleInfoList.push({
    name: `${VARIABLE_PREFIX}ToolVersion`,
    statement: `'${require('../../package.json').version}'`,
  });

  const exportExpressions = exportModuleInfoList
    .map(({ name, statement }) => {
      return `export const ${name} = ${statement};\n${LIBRARY_MODULE_NAME}.${name} = ${name};\n`;
    })
    .join('\n');

  fileContent.push(`
function decodeInfo(infoStr) {
  try {
    const decoder = new TextDecoder();
    const jsonStr = decoder.decode(new Uint8Array(infoStr.split(',')));
    return JSON.parse(jsonStr);
  } catch (e) {}

  return {};
}

const moduleInfoStr = '${PLACEHOLDER_ARCO_SITE_MODULE_INFO}';
const ${LIBRARY_MODULE_NAME} = {};

// Export submodules
${exportExpressions}

// Only used by team site development/isolate mode
if (window.arcoMaterialTeamSite && window.arcoMaterialTeamSite.renderPage) {
  const options = ${transformObjectToExpression({
    ...buildConfig.devOptions,
    withArcoStyle: siteConfig.arcoDesignLabTheme
      ? `${FUNCTION_LABEL}() => import('${siteConfig.arcoDesignLabTheme}/css/arco.css')${FUNCTION_LABEL}`
      : buildConfig.devOptions?.withArcoStyle,
  })};
  window.arcoMaterialTeamSite.renderPage(${LIBRARY_MODULE_NAME}, options);
}
`);

  fs.writeFileSync(getPathEntryByLanguage(language), fileContent.join('\n'));
}

export default async function generateEntryFiles({ isDev }: { isDev?: boolean } = {}) {
  const spinner = ora();
  await extendSiteConfigFromRemoteGroupSetting();

  if (!isDev) {
    // Make git ignore temp entry files
    const pathGitIgnore = path.resolve('.gitignore');
    if (fs.existsSync(pathGitIgnore)) {
      const gitIgnoreContent = fs.readFileSync(pathGitIgnore, 'utf8');
      if (gitIgnoreContent.indexOf(ENTRY_DIR_NAME) === -1) {
        fs.writeFileSync(pathGitIgnore, gitIgnoreContent.replace(/\n?$/, `\n${ENTRY_DIR_NAME}\n`));
      }
    }

    // Clear entry files
    fs.removeSync(entryFileDir);
  }

  spinner.start(locale.TIP_AUTO_GENERATE_ENTRY_FILE_ING);
  fs.ensureDirSync(entryFileDir);

  // Generate entry files
  const { pathInfoMap: submodulePathInfoMap, globsToWatch } = getSubmodulePath(
    buildConfig,
    siteConfig.languages
  );
  siteConfig.languages.forEach((lang) => {
    const documentTreeMap = {};
    Object.entries(submodulePathInfoMap).forEach(([submoduleKey, submoduleInfo]) => {
      documentTreeMap[submoduleKey] = generateSubmodules(submoduleInfo, lang);
    });
    generateEntries(submodulePathInfoMap, documentTreeMap, lang);
  });
  spinner.succeed(locale.TIP_AUTO_GENERATE_ENTRY_FILE_DONE);

  return [...new Set(globsToWatch)];
}
