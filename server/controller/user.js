const bcrypt = require('bcrypt');
const moment = require('moment');
const db = require('../model/db');
const redis = require('../model/redis');
const logger = require('../common/log').getLogger("app");
const sign = require('../common/sign').sign;
const config = require('../config');
const saltRounds = 10;

exports.logup = async (req, res) => {
    try {
        let body = req.body;
        let createAt = moment().format("YYYY-MM-DD HH:mm:ss");
        if (!(body instanceof Object)) {
            return res.json({
                err: '1',
                msg: '不是json的上传数据'
            });
        }
        let pattern = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;
        if ((!body.username) || (body.username && (body.username.length > 20 || body.username.length < 2))) {
            return res.json({
                err: 1,
                msg: '用户名必须为2-20位字符'
            });
        }
        if ((!body.password) || (body.password && (body.password.length > 16 || body.password.length < 6))) {
            return res.json({
                err: 1,
                msg: '密码必须为6-16位字符'
            });
        }
        if ((!body.email) || (body.email && !pattern.test(body.email))) {
            res.json({
                err: 1,
                msg: '邮箱格式不正确'
            });
        }
        if ((!body.captcha) || (body.captcha && body.captcha.length !== 6)) {
            return res.json({
                err: 1,
                msg: '验证码必须为6位'
            });
        }
        let names_count = await new Promise((resolve, reject) => {
            let sql = 'select id from User where username=?';
            db.query(sql, [body.username], (err, users) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(users.length);
                }
            });
        });

        if (names_count > 0) {
            return res.json({
                err: 1,
                msg: '该用户名已经被使用'
            });
        }

        let emails_count = await new Promise((resolve, reject) => {
            let sql = 'select id from User where email=?';
            db.query(sql, [body.email], (err, users) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(users.length);
                }
            })
        });
        if (emails_count > 0) {
            return res.json({
                err: 1,
                msg: '该邮箱已经被注册'
            });
        }
        let captcha = await new Promise((resolve, reject) => {
            redis.get(body.email, (err, captcha) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(captcha);
                }
            });
        });
        if (body.captcha !== captcha) {
            return res.json({
                err: 1,
                msg: '验证码错误'
            });
        }
        let hash = await new Promise((resolve, reject) => {
            bcrypt.hash(body.password, saltRounds, function (err, hash) {
                if (err) {
                    reject(err);
                } else {
                    resolve(hash);
                }
            });
        });
        body.password = hash;
        await new Promise((resolve, reject) => {
            let sql = 'insert into User (username, password, email, createAt) values (?, ?, ?, ?)';
            db.query(sql, [body.username, body.password, body.email, createAt], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        res.json({
            err: 0,
        });
    } catch (e) {
        logger.error(`logup_handle->${e}`);
        res.json({
            err: 1,
            msg: '服务器错误'
        });
    }
};

exports.login = async (req, res) => {
    try {
        let body = req.body;
        if (!(body instanceof Object)) {
            return res.json({
                err: '1',
                msg: '不是json的上传数据'
            });
        }
        if (!body.account) {
            return res.json({
                err: 1,
                msg: '帐号不能为空'
            });
        }
        if ((!body.password) || (body.password && (body.password.length > 16 || body.password.length < 6))) {
            return res.json({
                err: 1,
                msg: '密码长度必须为6-16个字符'
            });
        }
        let user = await new Promise((resolve, reject) => {
            let sql = 'select password, id from User where username=? or email=?';
            db.query(sql, [body.account, body.account], (err, users) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(users[0]);
                }
            });
        });
        if (!user) {
            return res.json({
                err: 1,
                msg: '该户名不存在'
            });
        }
        if (!user.password) {
            return res.json({
                err: 1,
                msg: '请通过github登录'
            });
        }
        let corrected = await new Promise((resolve, reject) => {
            bcrypt.compare(body.password, user.password, function (err, corrected) {
                if (err) {
                    reject(err);
                } else {
                    resolve(corrected);
                }
            });
        });
        if (corrected) {
            let token = await sign(user.id);
            return res.json({
                err: 0,
                token,
                msg: '登陆成功'
            });
        } else {
            return res.json({
                err: 1,
                msg: '密码错误'
            });
        }
    } catch (e) {
        logger.error(`login_handle->${e}`);
        res.json({
            err: 1,
            msg: '服务器错误'
        });
    }
};
exports.authGithub = async (req, res) => {
    try {
        let body = req.user;
        let user = await new Promise((resolve, reject) => {
            let sql = 'select id, username, email from User where githubId=?';
            db.query(sql, [body.id], (err, users) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(users[0]);
                }
            });
        });
        if (user) {
            if (body.username != user.username) {
                let names_count = await new Promise((resolve, reject) => {
                    let sql = 'select id from User where username=?';
                    db.query(sql, [body.username], (err, users) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(users.length);
                        }
                    });
                });
                if (names_count > 0) {
                    return res.json({
                        err: 1,
                        msg: '该用户名已经被使用'
                    });
                }
            }
            if (body.email != user.email) {
                let emails_count = await new Promise((resolve, reject) => {
                    let sql = 'select id from User where email=?';
                    db.query(sql, [body.email], (err, users) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(users.length);
                        }
                    });
                });
                if (emails_count > 0) {
                    return res.json({
                        err: 1,
                        msg: '该邮箱已经被注册'
                    });
                }
            }
            await new Promise((resolve, reject) => {
                let updateAt = moment().format("YYYY-MM-DD HH:mm:ss");
                let sql = `update User set username=?, email=?, avatar=?, website=?, introduction=?, location=?, github=?, updateAt=? where githubId=?`; 
                db.query(sql, [body.username, body._json.email, body._json.avatar_url, body._json.blog, body._json.bio, body._json.location, body.username, updateAt, body.id], err => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
            let token = await sign(user.id);
            res.redirect(`${config.github_client.callbackURL}?token=${token}`);
        } else {
            let names_count = await new Promise((resolve, reject) => {
                let sql = 'select id from User where username=?';
                db.query(sql, [body.username], (err, users) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(users.length);
                    }
                });
            });
            if (names_count > 0) {
                return res.json({
                    err: 1,
                    msg: '该用户名已经被使用'
                });
            }
            let emails_count = await new Promise((resolve, reject) => {
                let sql = 'select id from User where email=?';
                db.query(sql, [body.email], (err, users) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(users.length);
                    }
                });
            });
            if (emails_count > 0) {
                return res.json({
                    err: 1,
                    msg: '该邮箱已经被注册'
                });
            }
            await new Promise((resolve, reject) => {
                let createAt = moment().format("YYYY-MM-DD HH:mm:ss");
                let sql = `insert into User(githubId, username, email, avatar, website, introduction, location, github, createAt) 
                values(?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                db.query(sql, [body.id, body.username, body._json.email, body._json.avatar_url, body._json.blog, body._json.bio, body._json.location, body.username, createAt], err => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
            let _user = await new Promise((resolve, reject) => {
                let sql = 'select id from User where githubId=?';
                db.query(sql, [body.id], (err, users) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(users[0]);
                    }
                });
            });
            let token = await sign(_user.id);
            res.redirect(`${config.github_client.callbackURL}?token=${token}`);
        }
    } catch (e) {
        logger.error(`githubLogin_handle->${e}`);
        res.json({
            err: 1,
            msg: '服务器错误'
        });
    }
};
exports.userInfo = async (req, res) => {
    try {
        let id = req.session.uid;
        let user = await new Promise((resolve, reject) => {
            let sql = 'select * from User where id=?';
            db.query(sql, [id], (err, users) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(users[0]);
                }
            });
        });
        delete user.password;
        res.json({
            err: 0,
            user
        });
    } catch (e) {
        logger.error(`userInfo_handle->${e}`);
        res.json({
            err: 1,
            msg: '服务器出错了'
        });
    }
};
exports.userInfoById = async (req, res) => {
    try {
        let id = req.params.id;
        let user = await new Promise((resolve, reject) => {
            let sql = 'select * from User where id=?';
            db.query(sql, [id], (err, users) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(users[0]);
                }
            });
        });
        if (user.password) {
            delete user.password;
        }
        res.json({
            err: 0,
            user: user
        });
    } catch (e) {
        logger.error(`userInfoById->${e}`);
        res.json({
            err: 1,
            msg: '服务器出错了'
        });
    }
};

exports.user = async (req, res) => {
    try {
        let id = req.params.id;
        let user = await new Promise((resolve, reject) => {
            let sql = 'select * from User where id=?';
            db.query(sql, [id], (err, users) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(users[0]);
                }
            });
        });
        if (user) {
            delete user.password;
        }
        let topics = await new Promise((resolve, reject) => {
            let sql = `select title, tab, avatar, User.username as author, 
                    Topic.id, User.id as uid, Topic.CreateAt from Topic
                    left join User on Topic.author_id=User.id 
                    where User.id=?
                    order by Topic.createAt`;
            db.query(sql, [id], (err, topics) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(topics);
                }
            });
        });
        let collect_topics = await new Promise((resolve, reject) => {
            let sql = `select Topic.id, tab, avatar, User.username as author, title, body, Topic.createAt, User.id as uid 
                    from Collect left join Topic on Topic.id=Collect.tid
                    left join User on User.id=Collect.uid where Collect.uid=?`;
            db.query(sql, [id], (err, topics) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(topics);
                }
            });
        });
        res.json({
            err: 0,
            user: user,
            topics: topics,
            collect_topics: collect_topics
        });
    } catch (e) {
        logger.error(`user_handle->${e}`);
        res.json({
            err: 1,
            msg: '服务器出错了'
        });
    }
};
exports.userInfoEdit = async (req, res) => {
    try {
        let body = req.body;
        let id = req.session.uid;
        let updateAt = moment().format('YYYY-MM-DD HH:mm:ss');
        if ((!body.username) || (body.username && (body.username.length > 20 || body.username.length < 2))) {
            return res.json({
                err: 1,
                msg: '用户名必须为2-20位字符'
            });
        }
        let user = await new Promise((resolve, reject) => {
            let sql = 'select id, email, username from User where id=?';
            db.query(sql, [id], (err, users) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(users[0]);
                }
            });
        });
        if (user.username !== body.username) {
            let names_count = await new Promise((resolve, reject) => {
                let sql = 'select id from User where username=?';
                db.query(sql, [body.username], (err, users) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(users.length);
                    }
                });
            });

            if (names_count > 0) {
                return res.json({
                    err: 1,
                    msg: '该用户名已经被使用'
                });
            }
        }
        await new Promise((resolve, reject) => {
            let createAt = moment().format("YYYY-MM-DD HH:mm:ss");
            let sql = `update User set username=?, website=?, introduction=?, location=?, github=?, updateAt=?, sex=? where id=?`;
            db.query(sql, [body.username, body.website, body.introduction, body.location, body.github, updateAt, body.sex, id], err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        res.json({
            err: 0,
            msg: '更改成功'
        });
    } catch (e) {
        logger.error(`userinfoedit_handle->${e}`);
        res.json({
            err: 1,
            msg: '服务器出错了'
        });
    }
};
exports.forgotPassword = async (req, res) => {
    try {
        let body = req.body;
        if (!(body.username && body.username.length >= 2 && body.username.length <= 20)) {
            return res.json({
                err: 1,
                msg: '请输入用户名'
            });
        }
        if (!(body.captcha && body.captcha.length == 6 )) {
            return res.json({
                err: 1,
                msg: '请输入6位验证码'
            });
        }
        let captcha = await new Promise((resolve, reject) => {
            redis.get(body.username, (err, captcha) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(captcha);
                }
            });
        });
        if (captcha != body.captcha) {
            return res.json({
                err: 1,
                msg: '验证码不正确'
            });
        }
        body.password = await new Promise((resolve, reject) => {
            bcrypt.hash(body.password, saltRounds, function (err, hash) {
                if (err) {
                    reject(err);
                } else {
                    resolve(hash);
                }
            });
        });
        await new Promise((resolve, reject) => {
            let sql = 'update User set password=? where username=?';
            db.query(sql, [body.password, body.username], err => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
        res.json({
            err: 0,
            msg: '成功找回密码'
        });
    } catch (e) {
        logger.error(`forgotPassword_handle->${e}`);
        res.json({
            err: 1,
            msg: '服务器出错了'
        });
    }
};