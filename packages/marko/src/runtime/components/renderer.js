var componentsUtil = require("./util");
var componentLookup = componentsUtil.___componentLookup;

var ComponentsContext = require("./ComponentsContext");
var getComponentsContext = ComponentsContext.___getComponentsContext;
var registry = require("./registry");
var copyProps = require("raptor-util/copyProps");
var isServer = componentsUtil.___isServer === true;
var beginComponent = require("./beginComponent");
var endComponent = require("./endComponent");

var COMPONENT_BEGIN_ASYNC_ADDED_KEY = "$wa";

function resolveComponentKey(key, parentComponentDef) {
  if (key[0] === "#") {
    return key.substring(1);
  } else {
    return parentComponentDef.id + "-" + parentComponentDef.___nextKey(key);
  }
}

function trackAsyncComponents(out) {
  if (out.isSync() || out.global[COMPONENT_BEGIN_ASYNC_ADDED_KEY]) {
    return;
  }

  out.on("beginAsync", handleBeginAsync);
  out.on("beginDetachedAsync", handleBeginDetachedAsync);
  out.global[COMPONENT_BEGIN_ASYNC_ADDED_KEY] = true;
}

function handleBeginAsync(event) {
  var parentOut = event.parentOut;
  var asyncOut = event.out;
  var componentsContext = parentOut.___components;

  if (componentsContext !== undefined) {
    // We are going to start a nested ComponentsContext
    asyncOut.___components = new ComponentsContext(asyncOut, componentsContext);
  }
  // Carry along the component arguments
  asyncOut.c(
    parentOut.___assignedComponentDef,
    parentOut.___assignedKey,
    parentOut.___assignedCustomEvents
  );
}

function handleBeginDetachedAsync(event) {
  var asyncOut = event.out;
  handleBeginAsync(event);
  asyncOut.on("beginAsync", handleBeginAsync);
  asyncOut.on("beginDetachedAsync", handleBeginDetachedAsync);
}

function createRendererFunc(
  templateRenderFunc,
  componentProps,
  renderingLogic
) {
  var onInput = renderingLogic && renderingLogic.onInput;
  var typeName = componentProps.t;
  var isSplit = componentProps.s === true;
  var isImplicitComponent = componentProps.i === true;

  var shouldApplySplitMixins = renderingLogic && isSplit;

  // eslint-disable-next-line no-constant-condition
  if ("MARKO_DEBUG") {
    if (!componentProps.d) {
      throw new Error(
        "Component was compiled in a different NODE_ENV than the Marko runtime is using."
      );
    }
  } else if (componentProps.d) {
    throw new Error("Runtime/NODE_ENV Mismatch");
  }

  return function renderer(input, out) {
    trackAsyncComponents(out);

    var componentsContext = getComponentsContext(out);
    var globalComponentsContext = componentsContext.___globalContext;

    var component = globalComponentsContext.___rerenderComponent;
    var isRerender = component !== undefined;
    var id;
    var isExisting;
    var customEvents;
    var parentComponentDef = componentsContext.___componentDef;
    var ownerComponentDef = out.___assignedComponentDef;
    var ownerComponentId = ownerComponentDef && ownerComponentDef.id;
    var key = out.___assignedKey;

    if (component) {
      // If component is provided then we are currently rendering
      // the top-level UI component as part of a re-render
      id = component.id; // We will use the ID of the component being re-rendered
      isExisting = true; // This is a re-render so we know the component is already in the DOM
      globalComponentsContext.___rerenderComponent = null;
    } else {
      // Otherwise, we are rendering a nested UI component. We will need
      // to match up the UI component with the component already in the
      // DOM (if any) so we will need to resolve the component ID from
      // the assigned key. We also need to handle any custom event bindings
      // that were provided.
      if (parentComponentDef) {
        // console.log('componentArgs:', componentArgs);
        customEvents = out.___assignedCustomEvents;

        if (key != null) {
          id = resolveComponentKey(key.toString(), parentComponentDef);
        } else {
          id = parentComponentDef.___nextComponentId();
        }
      } else {
        id = globalComponentsContext.___nextComponentId();
      }
    }

    if (isServer) {
      // If we are rendering on the server then things are simplier since
      // we don't need to match up the UI component with a previously
      // rendered component already mounted to the DOM. We also create
      // a lightweight ServerComponent
      component = registry.___createComponent(
        renderingLogic,
        id,
        input,
        out,
        typeName,
        customEvents,
        ownerComponentId
      );

      // This is the final input after running the lifecycle methods.
      // We will be passing the input to the template for the `input` param
      input = component.___updatedInput;
    } else {
      if (!component) {
        if (
          isRerender &&
          (component = componentLookup[id]) &&
          component.___type !== typeName
        ) {
          // Destroy the existing component since
          component.destroy();
          component = undefined;
        }

        if (component) {
          isExisting = true;
        } else {
          isExisting = false;
          // We need to create a new instance of the component
          component = registry.___createComponent(typeName, id);

          if (shouldApplySplitMixins === true) {
            shouldApplySplitMixins = false;

            var renderingLogicProps =
              typeof renderingLogic == "function"
                ? renderingLogic.prototype
                : renderingLogic;

            copyProps(renderingLogicProps, component.constructor.prototype);
          }
        }

        // Set this flag to prevent the component from being queued for update
        // based on the new input. The component is about to be rerendered
        // so we don't want to queue it up as a result of calling `setInput()`
        component.___updateQueued = true;

        if (customEvents !== undefined) {
          component.___setCustomEvents(customEvents, ownerComponentId);
        }

        if (isExisting === false) {
          component.___emitCreate(input, out);
        }

        input = component.___setInput(input, onInput, out);

        if (isExisting === true) {
          if (
            component.___isDirty === false ||
            component.shouldUpdate(input, component.___state) === false
          ) {
            // We put a placeholder element in the output stream to ensure that the existing
            // DOM node is matched up correctly when using morphdom. We flag the VElement
            // node to track that it is a preserve marker
            out.___preserveComponent(component);
            globalComponentsContext.___renderedComponentsById[id] = true;
            component.___reset(); // The component is no longer dirty so reset internal flags
            return;
          }
        }
      }

      component.___global = out.global;
      component.___emitRender(out);
    }

    var componentDef = beginComponent(
      componentsContext,
      component,
      key,
      ownerComponentDef,
      isSplit,
      isImplicitComponent
    );

    componentDef.___isExisting = isExisting;

    // Render the template associated with the component using the final template
    // data that we constructed
    templateRenderFunc(
      input,
      out,
      componentDef,
      component,
      component.___rawState,
      out.global
    );

    endComponent(out, componentDef);
    componentsContext.___componentDef = parentComponentDef;
  };
}

module.exports = createRendererFunc;
