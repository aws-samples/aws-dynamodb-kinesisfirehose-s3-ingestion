// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export function isObject (val: object) {
  return val != null && typeof val === 'object' &&
    Object.prototype.toString.call(val) === '[object Object]'
}

export function isPlainObject (o: object) {
  if (Array.isArray(o) === true) {
    return true
  }

  if (!isObject(o)) {
    return false
  }

  // If has modified constructor
  const ctor = o.constructor
  if (typeof ctor !== 'function') {
    return false
  }

  // If has modified prototype
  const prot = ctor.prototype
  if (!isObject(prot)) {
    return false
  }

  // If constructor does not have an Object-specific method
  // eslint-disable-next-line
  if (!prot.hasOwnProperty('isPrototypeOf')) {
    return false
  }

  // Most likely a plain Object
  return true
}
