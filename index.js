/**
 * Module dependencies.
 */

const fs = require('fs')
const util = require('util')
const debug = require('debug')('koa-send')
const resolvePath = require('resolve-path')
const createError = require('http-errors')
const assert = require('assert')

// fs stat转成promise
const stat = util.promisify(fs.stat)

// fs access 转测promise
const access = util.promisify(fs.access)

// 判断是否存在
async function exists (path) {
  try {
    await access(path)
    return true
  } catch (e) {
    return false
  }
}

// normalize 规范化
// basename path的最后一部分
// extname  path的扩展名
// resolve  将path解析成绝对路径
// parse  返回path的有效元素对象
// sep  平台特定的路径片段分隔符
const {
  normalize,
  basename,
  extname,
  resolve,
  parse,
  sep
} = require('path')

/**
 * Expose `send()`.
 */

module.exports = send

/**
 * Send file at `path` with the
 * given `options` to the koa `ctx`.
 *
 * @param {Context} ctx
 * @param {String} path
 * @param {Object} [opts]
 * @return {Promise}
 * @api public
 */

async function send (ctx, path, opts = {}) {
  assert(ctx, 'koa context required')
  assert(path, 'pathname required')

  // options
  debug('send "%s" %j', path, opts)
  // root地址
  const root = opts.root ? normalize(resolve(opts.root)) : ''
  // 请求路径是不是 /开头
  const trailingSlash = path[path.length - 1] === '/'
  // 截掉root目录
  path = path.substr(parse(path).root.length)
  // index路径
  const index = opts.index
  // 最大周期
  const maxage = opts.maxage || opts.maxAge || 0
  // 表示正文不会随着时间变化
  const immutable = opts.immutable || false
  // 隐藏
  const hidden = opts.hidden || false
  // 格式
  const format = opts.format !== false
  // 扩展
  const extensions = Array.isArray(opts.extensions) ? opts.extensions : false
  const brotli = opts.brotli !== false
  // gzip亚索
  const gzip = opts.gzip !== false
  // 设置请求头
  const setHeaders = opts.setHeaders

  // 如果入参 setHeaders 但不是函数 报错
  if (setHeaders && typeof setHeaders !== 'function') {
    throw new TypeError('option setHeaders must be function')
  }

  // normalize path
  // 解码路径
  path = decode(path)

  // 说明解码失败
  if (path === -1) return ctx.throw(400, 'failed to decode')

  // index file support
  // 如果是/ 开头 并且 设置了index，那么把index 填到path里
  if (index && trailingSlash) path += index

  // 将root拼到path
  path = resolvePath(root, path)

  // hidden file support, ignore
  // 没有设置hidden 但是文件是隐藏的，直接返回
  if (!hidden && isHidden(root, path)) return

  let encodingExt = ''
  // serve brotli file when possible otherwise gzipped file when possible
  if (ctx.acceptsEncodings('br', 'identity') === 'br' && brotli && (await exists(path + '.br'))) {
    path = path + '.br'
    ctx.set('Content-Encoding', 'br')
    ctx.res.removeHeader('Content-Length')
    encodingExt = '.br'
  } else if (ctx.acceptsEncodings('gzip', 'identity') === 'gzip' && gzip && (await exists(path + '.gz'))) {
    path = path + '.gz'
    ctx.set('Content-Encoding', 'gzip')
    ctx.res.removeHeader('Content-Length')
    encodingExt = '.gz'
  }

  if (extensions && !/\./.exec(basename(path))) {
    const list = [].concat(extensions)
    for (let i = 0; i < list.length; i++) {
      let ext = list[i]
      if (typeof ext !== 'string') {
        throw new TypeError('option extensions must be array of strings or false')
      }
      if (!/^\./.exec(ext)) ext = `.${ext}`
      // 当匹配到 extensions 的文件时退出
      if (await exists(`${path}${ext}`)) {
        path = `${path}${ext}`
        break
      }
    }
  }

  // stat
  let stats
  try {
    // 读取path的stat信息
    stats = await stat(path)

    // Format the path to serve static file servers
    // and not require a trailing slash for directories,
    // so that you can do both `/directory` and `/directory/`
    if (stats.isDirectory()) {
      if (format && index) {
        path += `/${index}`
        stats = await stat(path)
      } else {
        return
      }
    }
  } catch (err) {
    const notfound = ['ENOENT', 'ENAMETOOLONG', 'ENOTDIR']
    if (notfound.includes(err.code)) {
      throw createError(404, err)
    }
    err.status = 500
    throw err
  }

  if (setHeaders) setHeaders(ctx.res, path, stats)

  // stream
  ctx.set('Content-Length', stats.size)
  if (!ctx.response.get('Last-Modified')) ctx.set('Last-Modified', stats.mtime.toUTCString())
  if (!ctx.response.get('Cache-Control')) {
    const directives = [`max-age=${(maxage / 1000 | 0)}`]
    if (immutable) {
      directives.push('immutable')
    }
    // 缓存控制
    ctx.set('Cache-Control', directives.join(','))
  }
  if (!ctx.type) ctx.type = type(path, encodingExt)
  // 读取文件
  ctx.body = fs.createReadStream(path)

  return path
}

/**
 * Check if it's hidden.
 * 检查他是否隐藏
 */

function isHidden (root, path) {
  // 把path分割成数组
  path = path.substr(root.length).split(sep)
  for (let i = 0; i < path.length; i++) {
    // 存不存在 .开头
    if (path[i][0] === '.') return true
  }
  return false
}

/**
 * File type.
 * 文件格式
 */

function type (file, ext) {
  return ext !== '' ? extname(basename(file, ext)) : extname(file)
}

/**
 * Decode `path`.
 * 解码path
 */

function decode (path) {
  try {
    return decodeURIComponent(path)
  } catch (err) {
    return -1
  }
}
