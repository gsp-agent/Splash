@group(0) @binding(0) var textureSampler: sampler;
@group(0) @binding(1) var depthTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uniforms: RenderUniforms;
@group(0) @binding(3) var thicknessTexture: texture_2d<f32>;
@group(0) @binding(4) var envmapTexture: texture_cube<f32>;
@group(0) @binding(5) var bgTexture: texture_2d<f32>;
@group(0) @binding(6) var<uniform> diffuseColor: vec3f;
@group(0) @binding(7) var<uniform> density: f32;

struct RenderUniforms {
    texelSize: vec2f, 
    sphereSize: f32, 
    invProjectionMatrix: mat4x4f, 
    projectionMatrix: mat4x4f, 
    viewMatrix: mat4x4f, 
    invViewMatrix: mat4x4f, 
}

struct FragmentInput {
    @location(0) uv: vec2f, 
    @location(1) iuv: vec2f, 
}

fn computeViewPosFromUVDepth(texCoord: vec2f, depth: f32) -> vec3f {
    var ndc: vec4f = vec4f(texCoord.x * 2.0 - 1.0, 1.0 - 2.0 * texCoord.y, 0.0, 1.0);
    ndc.z = -uniforms.projectionMatrix[2].z + uniforms.projectionMatrix[3].z / depth;
    ndc.w = 1.0;

    var eye_pos: vec4f = uniforms.invProjectionMatrix * ndc;

    return eye_pos.xyz / eye_pos.w;
}

fn getViewPosFromTexCoord(texCoord: vec2f, iuv: vec2f) -> vec3f {
    var depth: f32 = abs(textureLoad(depthTexture, vec2u(iuv), 0).x);
    return computeViewPosFromUVDepth(texCoord, depth);
}

fn gamma(v: vec3f) -> vec3f {
    return pow(v, vec3(1.0 / 2.2));
}
fn invGamma(v: vec3f) -> vec3f {
    return pow(v, vec3(2.2));
}

fn calcReflactedTexCoord(surfacePosView: vec3f, refractionDirView: vec3f, thickness: f32) -> vec2f {
    let refractionStrength = 3.;
    let exitPosView: vec3f = surfacePosView + refractionDirView * thickness * refractionStrength;
    let exitPosClip: vec4f = uniforms.projectionMatrix * vec4f(exitPosView, 1.);
    let exitPosNdc: vec3f = exitPosClip.xyz / exitPosClip.w;
    return clamp(vec2f((1. + exitPosNdc.x) / 2., (1. - exitPosNdc.y) / 2.), vec2f(0.), vec2f(1.));
}

@fragment
fn fs(input: FragmentInput) -> @location(0) vec4f {
    let depth: f32 = abs(textureLoad(depthTexture, vec2u(input.iuv), 0).r);
    var thickness = textureSample(thicknessTexture, textureSampler, input.uv).r;

    if (depth >= 1e4) {
        let bgColor: vec3f = textureSampleLevel(bgTexture, textureSampler, input.uv, 0.0).rgb;
        return vec4f(bgColor, 0.);
    }

    let surfacePosView = computeViewPosFromUVDepth(input.uv, depth);
    let surfacePosWorld = (uniforms.invViewMatrix * vec4f(surfacePosView, 1.0)).xyz;
    if (surfacePosWorld.y < 2.0) {
        let bgColor: vec3f = textureSampleLevel(bgTexture, textureSampler, input.uv, 0.0).rgb;
        return vec4f(bgColor, 0.);
    }
    var ddx: vec3f = getViewPosFromTexCoord(input.uv + vec2f(uniforms.texelSize.x, 0.), input.iuv + vec2f(1.0, 0.0)) - surfacePosView; 
    var ddy: vec3f = getViewPosFromTexCoord(input.uv + vec2f(0., uniforms.texelSize.y), input.iuv + vec2f(0.0, 1.0)) - surfacePosView; 
    let ddx2: vec3f = surfacePosView - getViewPosFromTexCoord(input.uv + vec2f(-uniforms.texelSize.x, 0.), input.iuv + vec2f(-1.0, 0.0));
    let ddy2: vec3f = surfacePosView - getViewPosFromTexCoord(input.uv + vec2f(0., -uniforms.texelSize.y), input.iuv + vec2f(0.0, -1.0));
    let maxDeltaZ = max(max(abs(ddx.z), abs(ddy.z)), max(abs(ddx2.z), abs(ddy2.z)));

    ddx = select(ddx, ddx2, abs(ddx.z) > abs(ddx2.z));
    ddy = select(ddy, ddy2, abs(ddy.z) > abs(ddy2.z));

    var normal: vec3f = -normalize(cross(ddx, ddy)); 
    var rayDirView = normalize(surfacePosView);
    let lightDirView = normalize((uniforms.viewMatrix * vec4f(-0.4, 0.85, 0.3, 0.0)).xyz);
    let H = normalize(lightDirView - rayDirView);
    let specular = pow(max(0.0, dot(H, normal)), 35.0);
    let diffuse = max(0.0, dot(lightDirView, normal));

    // Absorption alone gives tinted glass. Scattering supplies the opaque clay body.
    let opticalDepth = density * 8.0 * thickness;
    let transmission = exp(-opticalDepth);
    let transmittance = exp(-opticalDepth * (vec3f(1.0) - diffuseColor));
    let refractionDirView = normalize(refract(rayDirView, normal, 1.0 / 1.333));
    let refractionUV = calcReflactedTexCoord(surfacePosView, refractionDirView, thickness);
    let refractionColor = invGamma(textureSampleLevel(bgTexture, textureSampler, refractionUV, 0.0).rgb) * transmittance;
    let clayColor = invGamma(diffuseColor) * (0.42 + 0.58 * diffuse);
    let bodyColor = mix(clayColor, refractionColor, transmission);

    let fresnel = clamp(0.02 + 0.98 * pow(1.0 - dot(normal, -rayDirView), 5.0), 0.0, 1.0);
    let reflectionDirWorld = (uniforms.invViewMatrix * vec4f(reflect(rayDirView, normal), 0.0)).xyz;
    let reflectionColor = invGamma(textureSampleLevel(envmapTexture, textureSampler, reflectionDirWorld, 0.0).rgb);
    // A small environment contribution and a broad highlight keep the finish satin.
    let finalColor = mix(bodyColor, reflectionColor, 0.025 + 0.07 * fresnel) + vec3f(0.075 * specular);

    return vec4f(gamma(finalColor), 1.0);
}
