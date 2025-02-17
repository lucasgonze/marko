var complain = "MARKO_DEBUG" && require("complain");
var warp10Finalize = require("warp10/finalize");
var queueMicrotask = require("../../queueMicrotask");
var defineComponent = require("../defineComponent");
var eventDelegation = require("../event-delegation");
var createFragmentNode =
  require("../../vdom/morphdom/fragment").___createFragmentNode;
var ComponentDef = require("../ComponentDef");
var domData = require("../dom-data");
var componentsUtil = require("../util");
var componentLookup = componentsUtil.___componentLookup;
var addComponentRootToKeyedElements =
  componentsUtil.___addComponentRootToKeyedElements;
var keyedElementsByComponentId = domData.___ssrKeyedElementsByComponentId;
var componentsByDOMNode = domData.___componentByDOMNode;
var serverComponentRootNodes = {};
var serverRenderedMeta = {};
var win = window;

var DEFAULT_RUNTIME_ID = "M";
var FLAG_WILL_RERENDER_IN_BROWSER = 1;
// var FLAG_HAS_RENDER_BODY = 2;

var registered = {};
var loaded = {};
var componentTypes = {};
var deferredDefs;
var pendingDefs;

function register(type, def) {
  var pendingForType;
  if (pendingDefs) {
    pendingForType = pendingDefs[type];
  }
  registered[type] = def;
  delete loaded[type];
  delete componentTypes[type];

  if (pendingForType) {
    delete pendingDefs[type];
    queueMicrotask(function () {
      pendingForType.forEach(function (args) {
        tryHydrateComponent(args[0], args[1], args[2], args[3])();
      });
    });
  }

  return type;
}

function addPendingDef(def, type, meta, host, runtimeId) {
  if (!pendingDefs) {
    pendingDefs = {};

    // eslint-disable-next-line no-constant-condition
    if ("MARKO_DEBUG") {
      document.addEventListener("load", function () {
        var pendingComponentIds = Object.keys(pendingDefs);
        if (pendingComponentIds.length) {
          complain(
            "Marko templates were never loaded for: " + pendingComponentIds
          );
        }
      });
    }
  }
  (pendingDefs[type] = pendingDefs[type] || []).push([
    def,
    meta,
    host,
    runtimeId
  ]);
}

function load(typeName) {
  var target = loaded[typeName];
  if (!target) {
    target = registered[typeName];

    if (target) {
      target = target();
    }

    if (!target) {
      throw Error("Component not found: " + typeName);
    }

    loaded[typeName] = target;
  }

  return target;
}

function getComponentClass(typeName) {
  var ComponentClass = componentTypes[typeName];

  if (ComponentClass) {
    return ComponentClass;
  }

  ComponentClass = load(typeName);

  ComponentClass = ComponentClass.Component || ComponentClass;

  if (!ComponentClass.___isComponent) {
    ComponentClass = defineComponent(ComponentClass, ComponentClass.renderer);
  }

  // Make the component "type" accessible on each component instance
  ComponentClass.prototype.___type = typeName;

  // eslint-disable-next-line no-constant-condition
  if ("MARKO_DEBUG") {
    var classNameMatch =
      /\/([^/]+?)(?:\/index|\/template|)(?:\.marko|\.component(?:-browser)?|)$/.exec(
        typeName
      );
    var className = classNameMatch ? classNameMatch[1] : "AnonymousComponent";
    className = className.replace(/-(.)/g, function (g) {
      return g[1].toUpperCase();
    });
    className = className
      .replace(/\$\d+\.\d+\.\d+$/, "")
      .replace(/^[^a-z$_]/i, "_$&")
      .replace(/[^0-9a-z$_]+/gi, "_");
    className = className[0].toUpperCase() + className.slice(1);
    var OldComponentClass = ComponentClass;
    ComponentClass = {
      [className]: function (id, doc) {
        OldComponentClass.call(this, id, doc);
      }
    }[className];
    ComponentClass.prototype = OldComponentClass.prototype;
  }

  componentTypes[typeName] = ComponentClass;

  return ComponentClass;
}

function createComponent(typeName, id) {
  var ComponentClass = getComponentClass(typeName);
  return new ComponentClass(id);
}

function indexServerComponentBoundaries(node, runtimeId, stack) {
  var componentId;
  var ownerId;
  var ownerComponent;
  var keyedElements;
  var nextSibling;
  var runtimeLength = runtimeId.length;
  stack = stack || [];

  node = node.firstChild;
  while (node) {
    nextSibling = node.nextSibling;
    if (node.nodeType === 8) {
      // Comment node
      var commentValue = node.nodeValue;
      if (commentValue.slice(0, runtimeLength) === runtimeId) {
        var firstChar = commentValue[runtimeLength];

        if (firstChar === "^" || firstChar === "#") {
          stack.push(node);
        } else if (firstChar === "/") {
          var endNode = node;
          var startNode = stack.pop();
          var rootNode;

          if (startNode.parentNode === endNode.parentNode) {
            rootNode = createFragmentNode(startNode.nextSibling, endNode);
          } else {
            rootNode = createFragmentNode(
              endNode.parentNode.firstChild,
              endNode
            );
          }

          componentId = startNode.nodeValue.substring(runtimeLength + 1);
          firstChar = startNode.nodeValue[runtimeLength];

          if (firstChar === "^") {
            var parts = componentId.split(/ /g);
            var key = parts[2];
            ownerId = parts[1];
            componentId = parts[0];
            if ((ownerComponent = componentLookup[ownerId])) {
              keyedElements = ownerComponent.___keyedElements;
            } else {
              keyedElements =
                keyedElementsByComponentId[ownerId] ||
                (keyedElementsByComponentId[ownerId] = {});
            }
            addComponentRootToKeyedElements(
              keyedElements,
              key,
              rootNode,
              componentId
            );
          }

          serverComponentRootNodes[componentId] = rootNode;

          startNode.parentNode.removeChild(startNode);
          endNode.parentNode.removeChild(endNode);
        }
      }
    } else if (node.nodeType === 1) {
      // HTML element node
      var markoKey = node.getAttribute("data-marko-key");
      var markoProps = componentsUtil.___getMarkoPropsFromEl(node);
      if (markoKey) {
        var separatorIndex = markoKey.indexOf(" ");
        ownerId = markoKey.substring(separatorIndex + 1);
        markoKey = markoKey.substring(0, separatorIndex);
        if ((ownerComponent = componentLookup[ownerId])) {
          keyedElements = ownerComponent.___keyedElements;
        } else {
          keyedElements =
            keyedElementsByComponentId[ownerId] ||
            (keyedElementsByComponentId[ownerId] = {});
        }
        keyedElements[markoKey] = node;
      }
      if (markoProps) {
        Object.keys(markoProps).forEach(function (key) {
          if (key.slice(0, 2) === "on") {
            eventDelegation.___addDelegatedEventHandler(key.slice(2));
          }
        });
      }
      indexServerComponentBoundaries(node, runtimeId, stack);
    }

    node = nextSibling;
  }
}

function invokeComponentEventHandler(component, targetMethodName, args) {
  var method = component[targetMethodName];
  if (!method) {
    throw Error("Method not found: " + targetMethodName);
  }

  method.apply(component, args);
}

function addEventListenerHelper(el, eventType, isOnce, listener) {
  var eventListener = listener;
  if (isOnce) {
    eventListener = function (event) {
      listener(event);
      el.removeEventListener(eventType, eventListener);
    };
  }

  el.addEventListener(eventType, eventListener, false);

  return function remove() {
    el.removeEventListener(eventType, eventListener);
  };
}

function addDOMEventListeners(
  component,
  el,
  eventType,
  targetMethodName,
  isOnce,
  extraArgs,
  handles
) {
  var removeListener = addEventListenerHelper(
    el,
    eventType,
    isOnce,
    function (event) {
      var args = [event, el];
      if (extraArgs) {
        args = extraArgs.concat(args);
      }

      invokeComponentEventHandler(component, targetMethodName, args);
    }
  );
  handles.push(removeListener);
}

function initComponent(componentDef, host) {
  var component = componentDef.___component;

  component.___reset();
  component.___host = host;

  var isExisting = componentDef.___isExisting;

  if (isExisting) {
    component.___removeDOMEventListeners();
  }

  var domEvents = componentDef.___domEvents;
  if (domEvents) {
    var eventListenerHandles = [];

    domEvents.forEach(function (domEventArgs) {
      // The event mapping is for a direct DOM event (not a custom event and not for bubblign dom events)

      var eventType = domEventArgs[0];
      var targetMethodName = domEventArgs[1];
      var eventEl = component.___keyedElements[domEventArgs[2]];
      var isOnce = domEventArgs[3];
      var extraArgs = domEventArgs[4];

      addDOMEventListeners(
        component,
        eventEl,
        eventType,
        targetMethodName,
        isOnce,
        extraArgs,
        eventListenerHandles
      );
    });

    if (eventListenerHandles.length) {
      component.___domEventListenerHandles = eventListenerHandles;
    }
  }

  if (component.___mounted) {
    component.___emitUpdate();
  } else {
    component.___mounted = true;
    component.___emitMount();
  }
}

/**
 * This method is used to initialized components associated with UI components
 * rendered in the browser. While rendering UI components a "components context"
 * is added to the rendering context to keep up with which components are rendered.
 * When ready, the components can then be initialized by walking the component tree
 * in the components context (nested components are initialized before ancestor components).
 * @param  {Array<marko-components/lib/ComponentDef>} componentDefs An array of ComponentDef instances
 */
function initClientRendered(componentDefs, host) {
  if (!host) host = document;
  // Ensure that event handlers to handle delegating events are
  // always attached before initializing any components
  eventDelegation.___init(host);
  var len = componentDefs.length;
  var componentDef;
  var i;

  for (i = len; i--; ) {
    componentDef = componentDefs[i];
    trackComponent(componentDef);
  }

  for (i = len; i--; ) {
    componentDef = componentDefs[i];
    initComponent(componentDef, host);
  }
}

/**
 * This method initializes all components that were rendered on the server by iterating over all
 * of the component IDs.
 */
function initServerRendered(renderedComponents, host) {
  var type = typeof renderedComponents;
  var globalKey = "$";
  var runtimeId;

  if (type !== "object") {
    if (type === "string") {
      runtimeId = renderedComponents;
      globalKey += runtimeId + "_C";
    } else {
      globalKey += (runtimeId = DEFAULT_RUNTIME_ID) + "C";
    }

    renderedComponents = win[globalKey];

    // eslint-disable-next-line no-constant-condition
    if ("MARKO_DEBUG") {
      if (
        renderedComponents &&
        renderedComponents.i !== undefined &&
        renderedComponents.i !== componentsUtil.___runtimeId
      ) {
        console.warn(
          "Multiple instances of Marko have attached to the same runtime id. This could mean that more than one copy of Marko is loaded on the page, or that the script containing Marko has executed more than once."
        );
      }
    }

    var fakeArray = (win[globalKey] = {
      r: runtimeId,
      concat: initServerRendered
    });

    // eslint-disable-next-line no-constant-condition
    if ("MARKO_DEBUG") {
      fakeArray.i = componentsUtil.___runtimeId;
    }

    if (renderedComponents && renderedComponents.forEach) {
      renderedComponents.forEach(function (renderedComponent) {
        fakeArray.concat(renderedComponent);
      });
    }

    return fakeArray;
  }

  var isFromSerializedGlobals = this.concat === initServerRendered;
  renderedComponents = warp10Finalize(renderedComponents);

  if (isFromSerializedGlobals) {
    runtimeId = this.r;
    host = document;
  } else {
    runtimeId = renderedComponents.r || DEFAULT_RUNTIME_ID;
    if (!host) host = document;

    // eslint-disable-next-line no-constant-condition
    if ("MARKO_DEBUG") {
      complain(
        "Passing serialized data to `require('marko/components).init` is deprecated. Instead set '$global.runtimeId' and provide the 'runtimeId' option to your Marko bundler plugin."
      );
    }
  }

  // eslint-disable-next-line no-constant-condition
  if ("MARKO_DEBUG") {
    if (host !== document) {
      complain(
        "Passing a document other than the current document to `require('marko/components).init` is deprecated."
      );
    }
  }

  var prefix = renderedComponents.p || "";
  var meta = serverRenderedMeta[prefix];
  var isLast = renderedComponents.l;

  if (meta) {
    if (isLast) {
      delete serverRenderedMeta[prefix];
    }
  } else {
    meta = {};

    if (!isLast) {
      serverRenderedMeta[prefix] = meta;
    }
  }

  // Ensure that event handlers to handle delegating events are
  // always attached before initializing any components
  indexServerComponentBoundaries(host, runtimeId);
  eventDelegation.___init(host);

  if (renderedComponents.g) {
    meta.___globals = renderedComponents.g;
  }

  if (renderedComponents.t) {
    meta.___types = meta.___types
      ? meta.___types.concat(renderedComponents.t)
      : renderedComponents.t;
  }

  // hydrate components top down (leaf nodes last)
  // and return an array of functions to mount these components
  (renderedComponents.w || [])
    .map(function (componentDef) {
      var typeName = meta.___types[componentDef[1]];

      return registered[typeName]
        ? tryHydrateComponent(componentDef, meta, host, runtimeId)
        : addPendingDef(componentDef, typeName, meta, host, runtimeId);
    })
    .reverse()
    .forEach(tryInvoke);

  return this;
}

function tryHydrateComponent(rawDef, meta, host, runtimeId) {
  var componentDef = ComponentDef.___deserialize(
    rawDef,
    meta.___types,
    meta.___globals,
    exports
  );
  var mount = hydrateComponentAndGetMount(componentDef, host);

  if (!mount) {
    // hydrateComponentAndGetMount will return false if there is not rootNode
    // for the component.  If this is the case, we'll wait until the
    // DOM has fully loaded to attempt to init the component again.
    if (deferredDefs) {
      deferredDefs.push(componentDef);
    } else {
      deferredDefs = [componentDef];
      document.addEventListener("DOMContentLoaded", function () {
        indexServerComponentBoundaries(host, runtimeId);
        deferredDefs
          .map(function (componentDef) {
            return hydrateComponentAndGetMount(componentDef, host);
          })
          .reverse()
          .forEach(tryInvoke);
        deferredDefs = undefined;
      });
    }
  }

  return mount;
}

function hydrateComponentAndGetMount(componentDef, host) {
  var componentId = componentDef.id;
  var component = componentDef.___component;
  var rootNode = serverComponentRootNodes[componentId];
  var renderResult;

  if (rootNode) {
    delete serverComponentRootNodes[componentId];

    component.___rootNode = rootNode;
    componentsByDOMNode.set(rootNode, component);

    if (componentDef.___flags & FLAG_WILL_RERENDER_IN_BROWSER) {
      component.___host = host;
      renderResult = component.___rerender(component.___input, true);
      trackComponent(componentDef);
      return function mount() {
        renderResult.afterInsert(host);
      };
    } else {
      trackComponent(componentDef);
    }

    return function mount() {
      initComponent(componentDef, host);
    };
  }
}

function trackComponent(componentDef) {
  var component = componentDef.___component;
  if (component) {
    componentLookup[component.id] = component;
  }
}

function tryInvoke(fn) {
  if (fn) fn();
}

exports.r = register;
exports.___createComponent = createComponent;
exports.___getComponentClass = getComponentClass;
exports.___initServerRendered = win.$initComponents = initServerRendered;

require("../ComponentsContext").___initClientRendered = initClientRendered;
