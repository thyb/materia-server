module.exports = class MyTestCtrl {
	constructor(app) {
		this.app = app;
	}

	testPromise(req, res, next) {
		return Promise.resolve({
			x: 42
		})
	}

	testExpress(req, res, next) {
		res.send("ok")
	}

	testParams(req, res, next) {
		return Promise.resolve({
			body: req.body,
			query: req.query,
			params: req.params
		})
	}
}