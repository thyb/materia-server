import App from '../app'
import MateriaError from '../error'
import * as fs from 'fs'
import * as path from 'path'

import { IPermission, Permission } from './permission'

/**
 * @class Permissions
 * @classdesc
 * This class is used to set filters to the endpoints.
 */
export class Permissions {
	permissions: Permission[];

	constructor(private app: App) {
		this.app = app
		this.clear()
	}

	isAuthorized(permission) {

	}

	check(permissionsName:Array<string>) {
		return (req, res, next) => {
			let chain = (req, res, next) => { next() }

			let rev_permissions = permissionsName.reverse()

			rev_permissions.every(permissionName => {
				let permission = this.permissions.find(permission => permission.name == permissionName)

				if ( ! permission) {
					next(new MateriaError('Could not find permission "' + permissionName + '"'))
					return false
				}

				let nextchain = chain
				chain = (req, res, next) => {
					let _next = (e) => {
						if (e) {
							return res.status(500).json(JSON.stringify(e.message));
						}
						nextchain(req, res, next)
					}
					permission.middleware(req, res, _next)
				}
				return true
			})
			chain(req,res,next)
		}
	}

	private loadPermission(permission):IPermission {
		if ( ! permission.file) {
			return null
		}
		let permissionPath = path.join(this.app.path, 'server', 'permissions', permission.file)
		let rp = require.resolve(permissionPath)
		if (require.cache[rp]) {
			delete require.cache[rp]
		}
		let middleware = require(permissionPath)
		let obj = {
			name: permission.name,
			description: permission.description,
			middleware: middleware,
			file: permissionPath
		}
		console.log('before add', obj);
		return obj
	}

	load():Promise<any> {
		console.log('loading Permissions')
		this.clear()
		try {
			let permissionsPath = path.join(this.app.path, 'server', 'permissions')
			let resolvedPath = require.resolve(permissionsPath)
			if (require.cache[resolvedPath]) {
				delete require.cache[resolvedPath]
			}
			let permissionsRaw = require(permissionsPath)
			console.log(permissionsRaw);
			if (permissionsRaw && permissionsRaw.length) {
				let results = []
				permissionsRaw.forEach(permissionRaw => {
					let obj = this.loadPermission(permissionRaw)
					results.push(this.add(obj))
				})
				return Promise.all(results).then(() => {
					console.log(this.permissions);
					return true
				});
			}
			else {
				console.log('Nothing to load')
				return Promise.resolve()
			}
		}
		catch (e) {
			//no file permissions.js
			console.log('error with permissions:', e.stack)
			return Promise.resolve()
		}
	}

	/**
	Remove all permissions
	*/
	clear():void {
		this.permissions = []
		this.add({
			name: 'Anyone',
			description: 'Anyone are allowed without restriction',
			middleware: (req,res,next) => { return next() },
			readOnly: true
		})
	}

	/**
	Get all the registered permissions
	@returns {Array<IPermission>}
	*/
	findAll():Array<Permission> {
		return this.permissions
	}

	/**
	Get a permission's object
	@param {string} - The filter name
	@returns {function}
	*/
	get(name:string) {
		return this.permissions.find(permission => {
			return permission.name == name
		})
	}

	/**
	Add a permission.
	@param {string} - The filter name
	@param {function} - The function to execute when an endpoint uses this filter
	*/
	add(perm:IPermission, opts?:any):Promise<Permission> {
		if ( ! perm ) { return Promise.resolve(null) }
		if ( ! opts ) { opts = {} }
		if (this.permissions.find(permission => {
			return permission.name == perm.name
		})) {
			return Promise.reject(new MateriaError(`The permission ${perm.name} already exists`))
		}

		try {
			this.permissions.push(new Permission(this.app, perm))

			if ( opts.save && perm.file) {
				return this.app.saveFile(path.join(this.app.path, 'server', 'permissions', perm.file + '.js'), `module.exports = ${perm.middleware.toString()}`, {
					mkdir: true
				}).then(() => {
					return this.save();
				}).then(() => {
					return Promise.resolve(this.get(perm.name))
				})
			}
			else {
				return Promise.resolve(this.get(perm.name));
			}
		}
		catch (e) {
			console.log('Error:', e)
			return Promise.reject(e)
		}
	}

	update(name, permission, opts?: any): Promise<Permission> {
		return new Promise((resolve, reject) => {
			this.permissions.forEach(p => {
				if (p.file && ! p.readOnly && name == p.name) {
					p.name = permission.name
					p.description = permission.description
					if (path.join(this.app.path, 'server', 'permissions', permission.file + '.js') != p.file + '.js') {
						console.log('rename', 'oldFile: ' + p.file + '.js', 'newFile: ' + path.join(this.app.path, 'server', 'permissions', permission.file))
						fs.rename(p.file + '.js', path.join(this.app.path, 'server', 'permissions', permission.file + '.js'), (err) => {
							if (err) {
								return reject(err)
							}
							p.file = path.join(this.app.path, 'server', 'permissions', permission.file)
							p.reload()
							if (opts && opts.save) {
								return this.save().then(() => {
									return resolve(p)
								})
							}
							else {
								return resolve(p)
							}
						})
					}
					else {
						p.reload()
						if (opts && opts.save) {
							this.save().then(() => {
								return resolve(p)
							})
						}
						else {
							return resolve(p)
						}
					}
				}
			})
		})
	}

	/**
	Remove a filter
	@param {string} - The filter name
	*/
	remove(name, opts?):Promise<any> {
		let permission = this.permissions.find(permission => {
			return permission.name == name
		})
		let index = this.permissions.indexOf(permission)
		if (index != -1) {
			if (opts && opts.removeSource) {
				console.log('permission file to remove', permission.file)
				fs.unlinkSync(permission.file + '.js')
			}

			this.permissions.splice(index, 1)

			if (opts && opts.save) {
				return this.save()
			}
			else return Promise.resolve()
		}
	}

	save():Promise<any> {
		return this.app.saveFile(path.join(this.app.path, 'server', 'permissions.json'), JSON.stringify(this.toJson(), null, 2), {
			mkdir: true
		})
	}

	toJson(): IPermission[] {
		let result = []
		this.permissions.forEach(permission => {
			let json = permission.toJson()
			if ( ! json.readOnly ) {
				delete json.readOnly
				result.push(json)
			}
		})
		return result
	}
}