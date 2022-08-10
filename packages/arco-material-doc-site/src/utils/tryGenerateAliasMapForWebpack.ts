import glob from 'glob';
import path from 'path';
import fs from 'fs-extra';
import { print } from 'arco-cli-dev-utils';

import locale from '../locale';
import getMainConfig from './getMainConfig';
import { GlobConfigForBuild } from '../interface';

// Ensure that the result information is only printed once
let needPrintResult = true;

export default function tryGenerateAliasMapForWebpack() {
  const result = {};
  const {
    build: { globs },
  } = getMainConfig();

  let packagePathList = [];
  const extendPackagePathList = ({ component }: GlobConfigForBuild) => {
    if (component?.base) {
      packagePathList = packagePathList.concat(glob.sync(component.base));
    }
  };

  if (Array.isArray(globs)) {
    globs.forEach((item) => extendPackagePathList(item));
  } else if (typeof globs === 'object' && !globs.component && !globs.doc) {
    Object.entries(globs as Record<string, GlobConfigForBuild>).forEach(([_, item]) =>
      extendPackagePathList(item)
    );
  } else {
    extendPackagePathList(globs as GlobConfigForBuild);
  }

  packagePathList.forEach((_path) => {
    const pathPackageJson = path.resolve(_path, 'package.json');
    const pathSrc = path.resolve(_path, 'src');
    if (fs.existsSync(pathPackageJson) && fs.existsSync(pathSrc)) {
      const { name: packageName } = fs.readJsonSync(pathPackageJson);
      result[`${packageName}$`] = pathSrc;
    }
  });

  if (needPrintResult && Object.keys(result).length) {
    print.success('[arco-doc-site]', locale.TIP_WEBPACK_ALIAS_COLLECT_RESULT);
    print.info(JSON.stringify(result, null, 2));
    needPrintResult = false;
  }

  return result;
}
