import { t as _t } from "marko/src/runtime/html/index.js";
const _marko_componentType = "packages/translator-default/test/fixtures/error-at-tags-repeated-not-allowed/template.marko",
  _marko_template = _t(_marko_componentType);
export default _marko_template;
import _marko_self_iterator from "marko/src/runtime/helpers/self-iterator.js";
import _someTag from "./components/some-tag/index.marko";
import _marko_tag from "marko/src/runtime/helpers/render-tag.js";
import _marko_renderer from "marko/src/runtime/components/renderer.js";
const _marko_component = {};
_marko_template._ = _marko_renderer(function (input, out, _componentDef, _component, state, $global) {
  _marko_tag(_someTag, {
    "header": [{
      "class": "my-header",
      "renderBody": out => {
        out.w("Header content");
      },
      [Symbol.iterator]: _marko_self_iterator
    }, {
      "class": "my-header",
      "renderBody": out => {
        out.w("Header content");
      },
      [Symbol.iterator]: _marko_self_iterator
    }]
  }, out, _componentDef, "0");
}, {
  t: _marko_componentType,
  i: true,
  d: true
}, _marko_component);