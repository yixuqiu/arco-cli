import React from 'react';
import { UIRuntime } from '@arco-cli/service/dist/ui/uiRuntime';

import { ComponentAspect, ComponentUI } from '@aspect/component/uiRuntime';

import DocsAspect from '../docs.aspect';
import { Overview } from './overview';

export class DocsUI {
  static runtime = UIRuntime;

  static dependencies = [ComponentAspect];

  static slots = [];

  static provider([component]: [ComponentUI]) {
    component.registerRoute({
      index: true,
      element: <Overview />,
    });
    const docUI = new DocsUI();
    return docUI;
  }

  constructor() {}
}

DocsAspect.addRuntime(DocsUI);
