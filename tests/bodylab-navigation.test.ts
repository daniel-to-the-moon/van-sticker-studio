import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const page = ts.createSourceFile(
  'page.tsx',
  fs.readFileSync('app/body-lab/page.tsx', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function returnLink() {
  const nativeLinkTags = new Set(['a']);
  for (const statement of page.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'next/link' &&
      statement.importClause?.name
    ) {
      nativeLinkTags.add(statement.importClause.name.text);
    }
  }
  const links: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxElement(node) &&
      nativeLinkTags.has(node.openingElement.tagName.getText(page)) &&
      node.openingElement.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(page) === 'href' &&
          attribute.initializer !== undefined &&
          ts.isStringLiteral(attribute.initializer) &&
          attribute.initializer.text === '/',
      )
    ) {
      links.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(page);
  assert.equal(links.length, 1, 'Body Lab must expose one native home link');
  return links[0];
}

void test('Body Lab has a native, same-tab home link with default keyboard access', () => {
  const link = returnLink();
  const attributes = link.openingElement.attributes.properties.map(
    (attribute) => {
      assert.ok(ts.isJsxAttribute(attribute), 'navigation must be explicit');
      return attribute.name.getText(page);
    },
  );
  for (const attribute of [
    'tabIndex',
    'role',
    'target',
    'hidden',
    'aria-hidden',
    'onClick',
  ]) {
    assert.ok(
      !attributes.includes(attribute),
      `${attribute} must not override native navigation`,
    );
  }
  assert.ok(link.parent && ts.isJsxElement(link.parent));
  assert.equal(link.parent.openingElement.tagName.getText(page), 'header');
});

void test('Body Lab return link names the studio destination in both page languages', () => {
  const label = returnLink().children.find(ts.isJsxExpression)?.expression;
  assert.ok(label && ts.isConditionalExpression(label));
  assert.equal(label.condition.getText(page), "lang === 'zh'");
  assert.ok(ts.isStringLiteral(label.whenTrue));
  assert.ok(ts.isStringLiteral(label.whenFalse));
  assert.equal(label.whenTrue.text, '返回工作台');
  assert.equal(label.whenFalse.text, 'Back to studio');
});
