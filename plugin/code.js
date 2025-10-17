const UI_CONFIG = { width: 480, height: 780 };

figma.showUI(__html__, UI_CONFIG);

function getSelectedPrimaryNode() {
  const selection = figma.currentPage.selection;
  const node = selection.length > 0 ? selection[0] : null;
  if (!node) {
    return { error: '컴포넌트를 선택해 주세요.' };
  }
  if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
    return { error: 'Component 또는 Component Set만 지원합니다.' };
  }
  return { node };
}

function tokenFromStyleId(styleId) {
  if (!styleId) {
    return null;
  }
  const style = figma.getStyleById(styleId);
  return style ? style.name : null;
}

function summarizeFill(fill) {
  const summary = {
    type: fill.type,
    opacity: typeof fill.opacity === 'number' ? Number(fill.opacity.toFixed(2)) : 1
  };

  if (fill.type === 'SOLID') {
    const r = Math.round(fill.color.r * 255);
    const g = Math.round(fill.color.g * 255);
    const b = Math.round(fill.color.b * 255);
    summary.color = `rgb(${r}, ${g}, ${b})`;
  }

  if ('visible' in fill) {
    summary.visible = fill.visible;
  }

  return summary;
}

function extractAutoLayout(node) {
  if (!('layoutMode' in node) || node.layoutMode === 'NONE') {
    return null;
  }

  const padding = {
    top: typeof node.paddingTop === 'number' ? node.paddingTop : 0,
    right: typeof node.paddingRight === 'number' ? node.paddingRight : 0,
    bottom: typeof node.paddingBottom === 'number' ? node.paddingBottom : 0,
    left: typeof node.paddingLeft === 'number' ? node.paddingLeft : 0
  };

  return {
    direction: node.layoutMode === 'HORIZONTAL' ? 'Horizontal' : 'Vertical',
    spacing: typeof node.itemSpacing === 'number' ? node.itemSpacing : 0,
    padding,
    alignment: node.primaryAxisAlignItems === 'SPACE_BETWEEN'
      ? 'Space Between'
      : `${node.primaryAxisAlignItems}/${node.counterAxisAlignItems}`
  };
}

function extractTextStyles(component) {
  const textNodes = component.findAll(function (node) { return node.type === 'TEXT'; });
  const styles = [];
  for (const textNode of textNodes) {
    const entry = {
      token: null,
      fontSize: null,
      lineHeight: null
    };

    if (textNode.textStyleId && textNode.textStyleId !== figma.mixed) {
      entry.token = tokenFromStyleId(textNode.textStyleId);
    }

    if (textNode.fontSize && textNode.fontSize !== figma.mixed) {
      entry.fontSize = textNode.fontSize;
    }

    const lineHeight = textNode.lineHeight;
    if (lineHeight !== figma.mixed) {
      if (typeof lineHeight === 'object') {
        if (lineHeight.unit === 'AUTO') {
          entry.lineHeight = 'AUTO';
        } else if (lineHeight.unit === 'PERCENT') {
          entry.lineHeight = `${lineHeight.value}%`;
        } else if (lineHeight.unit === 'PIXELS') {
          entry.lineHeight = lineHeight.value;
        }
      }
    }

    styles.push(entry);
  }

  const uniqueStyles = [];
  const seen = new Set();
  for (const style of styles) {
    const key = JSON.stringify(style);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueStyles.push(style);
    }
  }

  return uniqueStyles;
}

function extractSubcomponents(component) {
  if (!('children' in component)) {
    return [];
  }

  return component.children.map(function (child) {
    let description = '';
    if (child.type === 'INSTANCE' && child.mainComponent) {
      description = `Instance of ${child.mainComponent.name}`;
    } else if (child.type === 'TEXT') {
      description = `텍스트 노드, 글자 수: ${child.characters.length}`;
    } else if ('children' in child) {
      description = `${child.type.toLowerCase()} (${child.children.length} children)`;
    } else {
      description = child.type.toLowerCase();
    }

    return {
      role: child.name,
      nodeType: child.type,
      description
    };
  });
}

function extractFills(node) {
  if (!('fills' in node) || node.fills === figma.mixed || !Array.isArray(node.fills)) {
    return [];
  }

  return node.fills.map(function (fill) {
    const summary = summarizeFill(fill);
    const styleId = 'fillStyleId' in node ? node.fillStyleId : null;
    const token = styleId && styleId !== figma.mixed ? tokenFromStyleId(styleId) : null;
    if (token) {
      summary.token = token;
    }
    return summary;
  });
}

function getBaseComponent(node) {
  if (node.type === 'COMPONENT') {
    return node;
  }
  const defaultVariant = node.defaultVariant || node.children[0];
  return defaultVariant || null;
}

function extractVariantData(node) {
  if (node.type !== 'COMPONENT_SET') {
    if (node.type === 'COMPONENT' && node.variantProperties) {
      return [
        {
          name: node.name,
          properties: node.variantProperties
        }
      ];
    }
    return [];
  }

  return node.children.map(function (child) {
    return {
      name: child.name,
      properties: child.variantProperties
    };
  });
}

function extractMetadata() {
  const { node, error } = getSelectedPrimaryNode();
  if (error) {
    return { error };
  }

  const baseComponent = getBaseComponent(node);
  if (!baseComponent) {
    return { error: '기본 Variant를 찾지 못했습니다.' };
  }

  const metadata = {
    name: node.name,
    semanticRole: node.name.split('/').slice(-1)[0],
    variants: extractVariantData(node),
    autoLayout: extractAutoLayout(baseComponent),
    fills: extractFills(baseComponent),
    textStyles: extractTextStyles(baseComponent),
    description: baseComponent.description || '(정보 없음)',
    subcomponents: extractSubcomponents(baseComponent),
    usageNotes: []
  };

  return { data: metadata };
}

function dispatchMetadata() {
  const result = extractMetadata();
  figma.ui.postMessage({ type: 'metadata', payload: result });
}

figma.on('selectionchange', () => {
  dispatchMetadata();
});

figma.ui.onmessage = function (msg) {
  if (!msg || !msg.type) {
    return;
  }

  if (msg.type === 'request-metadata') {
    dispatchMetadata();
    return;
  }

  if (msg.type === 'copy-guide') {
    let success = false;
    let errorMessage = '';
    try {
      if (typeof figma.copyText === 'function') {
        figma.copyText(typeof msg.payload === 'string' ? msg.payload : '');
        success = true;
      } else {
        errorMessage = 'copyText API를 사용할 수 없습니다.';
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    figma.ui.postMessage({
      type: 'copy-result',
      payload: { success, message: success ? '가이드를 복사했습니다.' : errorMessage || '복사에 실패했습니다.' }
    });
  }
};

dispatchMetadata();
