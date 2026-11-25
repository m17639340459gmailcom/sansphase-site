package com.sansphase.captcha;

import cloud.tianai.captcha.resource.ResourceProvider;
import cloud.tianai.captcha.resource.common.model.dto.Resource;

import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.RenderingHints;
import java.awt.geom.Path2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** Original scenery assets only; puzzle cutting and answer generation belong to Tianai. */
final class BackgroundResources implements ResourceProvider {
    private final List<byte[]> images;

    BackgroundResources() throws IOException {
        var original = new ArrayList<byte[]>(16);
        var random = new SecureRandom();
        for (int i = 0; i < 16; i++) original.add(render(new Random(random.nextLong()), i));
        images = List.copyOf(original);
    }

    int size() { return images.size(); }

    @Override public boolean supported(Resource resource) {
        return "sansphase-scenery".equals(resource.getType());
    }

    @Override public String getName() { return "sansphase-scenery"; }

    @Override public InputStream getResourceInputStream(Resource resource) {
        int index = Integer.parseInt(resource.getData());
        if (index < 0 || index >= images.size()) throw new IllegalArgumentException("invalid scenery asset");
        return new ByteArrayInputStream(images.get(index));
    }

    private static byte[] render(Random random, int scene) throws IOException {
        var image = new BufferedImage(600, 360, BufferedImage.TYPE_INT_RGB);
        var graphics = image.createGraphics();
        try {
            graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            Color top = Color.getHSBColor((scene * 0.07f + random.nextFloat() * 0.04f) % 1, 0.26f, 0.68f);
            Color bottom = new Color(215 + random.nextInt(25), 200 + random.nextInt(35), 185 + random.nextInt(35));
            graphics.setPaint(new GradientPaint(0, 0, top, 320, 360, bottom));
            graphics.fillRect(0, 0, 600, 360);
            graphics.setColor(new Color(252, 236, 196, 220));
            int sunX = 55 + random.nextInt(480);
            int sunY = 25 + random.nextInt(100);
            graphics.fillOval(sunX, sunY, 38 + random.nextInt(35), 38 + random.nextInt(35));
            for (int layer = 0; layer < 4; layer++) {
                var ridge = new Path2D.Double();
                ridge.moveTo(-20, 360);
                ridge.lineTo(-20, 110 + layer * 50 + random.nextInt(45));
                for (int x = 0; x <= 680; x += 55 + random.nextInt(55)) {
                    ridge.lineTo(x, 100 + layer * 48 + random.nextInt(100));
                }
                ridge.lineTo(640, 360);
                ridge.closePath();
                graphics.setColor(new Color(55 + layer * 18 + random.nextInt(25), 74 + layer * 17, 87 + layer * 13));
                graphics.fill(ridge);
            }
            for (int i = 0; i < 70; i++) {
                int x = random.nextInt(600), y = random.nextInt(360), size = 2 + random.nextInt(7);
                graphics.setColor(new Color(200 + random.nextInt(55), 190 + random.nextInt(50), 175 + random.nextInt(70), 120));
                graphics.fillOval(x, y, size, size);
            }
            graphics.setStroke(new BasicStroke(1.4f));
            graphics.setColor(new Color(234, 222, 187, 170));
            for (int i = 0; i < 10; i++) {
                int x = random.nextInt(560), y = 150 + random.nextInt(180);
                graphics.drawArc(x, y, 50 + random.nextInt(100), 20 + random.nextInt(45), 0, 150);
            }
        } finally {
            graphics.dispose();
        }
        var bytes = new ByteArrayOutputStream();
        if (!ImageIO.write(image, "png", bytes)) throw new IOException("PNG encoder unavailable");
        return bytes.toByteArray();
    }
}
