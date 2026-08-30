// Browser half of the fixture-legacy-store e2e fixture — handwritten in the
// exact frozen-module-table factory format the host serves (`window.
// __ModuleLoader__.load({id, factory})`), no build step.
//
// THE BREAK POINT: `require("@deepseek-ai/dsh-client-runtime/client")` is a
// frozen-module-table row on host 0.1.1-rc.2 and was REMOVED on 0.1.2, so this
// factory throws at load there (`window.__LEGACY_STORE_LOADED__` stays
// undefined) until the upgrading agent replaces the require with an inline
// implementation or a probe of the new surface.
window.__ModuleLoader__.load({
	id: "@fixture/legacy-store",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		window.__LEGACY_STORE_LOADED__ = true;
		document.title = "legacy-store loaded";
		exports.loaded = true;
		// The client runner applies every bundle as a browser-side cordis
		// plugin; a no-op apply keeps the console clean (the marker above is
		// the real signal).
		exports.apply = () => {};
		return module.exports;
	}
});
